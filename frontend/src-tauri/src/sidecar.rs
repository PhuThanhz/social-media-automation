//! Khởi động backend Java + worker Node đi kèm app, chỉ nghe trên 127.0.0.1 và yêu cầu token phiên.
//!
//! Bố cục trong bundle (do scripts/prepare-sidecar.mjs tạo ra):
//!   <resources>/sidecar/backend.jar   Spring Boot (profile desktop, DB H2)
//!   <resources>/sidecar/jre/          JRE rút gọn bằng jlink
//!   <resources>/sidecar/node/node     Node runtime
//!   <resources>/sidecar/worker/       mã nguồn worker + node_modules (+ .build-id)
//!
//! Dữ liệu ghi được nằm trong app data dir: backend/ (uploads, cwd của backend), db/, worker/ (bản copy worker),
//! ms-playwright/ (Chromium), logs/.
//! Bản dev chưa chạy prepare-sidecar thì dùng backend/worker đang chạy sẵn ở 8081/3001, không token.

use serde::Serialize;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::license;

const BACKEND_PORT: u16 = 47081;
const WORKER_PORT: u16 = 47001;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicesStatus {
    pub phase: Phase,
    pub message: String,
    /// Cảnh báo không chặn khởi động (vd chưa tải được Chromium)
    pub warning: Option<String>,
    pub api_base: Option<String>,
    pub worker_base: Option<String>,
    pub token: Option<String>,
}

struct Inner {
    status: ServicesStatus,
    children: Vec<Child>,
}

pub struct Services(Mutex<Inner>);

impl Services {
    pub fn new() -> Self {
        Services(Mutex::new(Inner {
            status: ServicesStatus {
                phase: Phase::Idle,
                message: String::new(),
                warning: None,
                api_base: None,
                worker_base: None,
                token: None,
            },
            children: Vec::new(),
        }))
    }

    fn set(&self, phase: Phase, message: impl Into<String>) {
        let mut inner = self.0.lock().unwrap();
        inner.status.phase = phase;
        inner.status.message = message.into();
    }

    fn warn(&self, warning: impl Into<String>) {
        self.0.lock().unwrap().status.warning = Some(warning.into());
    }

    pub fn session_token(&self) -> Option<String> {
        self.0.lock().unwrap().status.token.clone()
    }

    /// Dừng backend + worker (gọi khi app thoát hoặc bản quyền bị thu hồi)
    pub fn stop_all(&self) {
        let mut inner = self.0.lock().unwrap();
        for child in inner.children.iter_mut() {
            terminate(child);
        }
        inner.children.clear();
        inner.status.phase = Phase::Idle;
        inner.status.token = None;
    }
}

fn terminate(child: &mut Child) {
    // Cho worker cơ hội đóng Chromium gọn gàng trước khi kill hẳn
    #[cfg(unix)]
    {
        let _ = Command::new("kill").arg("-TERM").arg(child.id().to_string()).status();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Secret ký JWT đăng nhập trong app: riêng từng máy, sinh một lần rồi giữ (đăng nhập còn hiệu lực qua các lần mở app)
fn jwt_secret(data: &Path) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let path = data.join("jwt.secret");
    if let Ok(existing) = fs::read_to_string(&path) {
        if existing.trim().len() >= 64 {
            return Ok(existing.trim().to_string());
        }
    }
    let mut buf = [0u8; 48];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    let secret = STANDARD.encode(buf);
    fs::write(&path, &secret).map_err(|e| e.to_string())?;
    Ok(secret)
}

fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("không tạo được số ngẫu nhiên");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            // fs::copy giữ quyền thực thi (ffmpeg trong node_modules)
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Lần chạy trước có thể chưa thoát hẳn (backend/worker tự thoát trong ~5s khi app cha mất)
fn wait_port_free(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !port_free(port) {
        if Instant::now() > deadline {
            return Err(format!("Cổng {port} đang bị ứng dụng khác sử dụng. Hãy tắt ứng dụng đó rồi mở lại ToolZutter."));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Ok(())
}

fn log_file(logs: &Path, name: &str) -> Result<(Stdio, Stdio), String> {
    let f = fs::File::create(logs.join(name)).map_err(|e| e.to_string())?;
    let f2 = f.try_clone().map_err(|e| e.to_string())?;
    Ok((Stdio::from(f), Stdio::from(f2)))
}

fn hide_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn log_tail(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(15)..].join("\n")
}

#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.mode() & 0o111 == 0 {
            perms.set_mode(perms.mode() | 0o755);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

struct Paths {
    res: PathBuf,
    data: PathBuf,
    logs: PathBuf,
}

/// Chép worker sang app data khi app vừa cài/cập nhật (bundle chỉ đọc, worker cần ghi file trạng thái cạnh mã nguồn)
fn sync_worker(p: &Paths, services: &Services) -> Result<bool, String> {
    let src = p.res.join("worker");
    let dst = p.data.join("worker");
    let shipped = fs::read_to_string(src.join(".build-id")).unwrap_or_default();
    let installed = fs::read_to_string(dst.join(".build-id")).unwrap_or_default();
    if !shipped.is_empty() && shipped == installed {
        return Ok(false);
    }
    services.set(Phase::Starting, "Đang cài đặt thành phần tự động hóa...");
    let _ = fs::remove_dir_all(dst.join("node_modules"));
    copy_dir(&src, &dst).map_err(|e| format!("Không chép được worker: {e}"))?;
    Ok(true)
}

/// Tải Chromium cho Playwright vào app data (lần đầu, hoặc khi worker cập nhật phiên bản Playwright)
fn ensure_chromium(p: &Paths, node: &Path, force: bool, services: &Services) -> Result<(), String> {
    let browsers = p.data.join("ms-playwright");
    let marker = browsers.join(".installed");
    if !force && marker.exists() {
        return Ok(());
    }
    services.set(Phase::Starting, "Đang tải trình duyệt Chromium (khoảng 250MB, chỉ lần đầu)...");
    let (out, err) = log_file(&p.logs, "playwright-install.log")?;
    let status = hide_window(
        Command::new(node)
            .arg(p.data.join("worker/node_modules/playwright/cli.js"))
            .args(["install", "chromium", "chromium-headless-shell"])
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers)
            .current_dir(p.data.join("worker"))
            .stdout(out)
            .stderr(err),
    )
    .status()
    .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!(
            "Chưa tải được Chromium, các tính năng đăng bài sẽ chưa dùng được. Kiểm tra mạng rồi mở lại app.\n{}",
            log_tail(&p.logs.join("playwright-install.log"))
        ));
    }
    let _ = fs::write(marker, "ok");
    Ok(())
}

/// Tauri canonicalize đường dẫn app → trên Windows ra dạng `\\?\C:\...`.
/// Java (-jar) không nạp được class từ đường dẫn này (ClassNotFoundException JarLauncher),
/// nên bỏ tiền tố `\\?\` khi đường dẫn là ổ đĩa thường (giữ nguyên `\\?\UNC\...`).
fn plain_path(p: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(rest) = p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            if !rest.starts_with(r"UNC\") {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

fn boot(app: &AppHandle, services: &Services) -> Result<(), String> {
    let res = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?.join("sidecar"));
    let data = plain_path(app.path().app_data_dir().map_err(|e| e.to_string())?);

    // Bản dev chưa đóng gói sidecar: dùng backend/worker dev đang chạy, không token
    if !res.join("backend.jar").exists() {
        if cfg!(debug_assertions) {
            let mut inner = services.0.lock().unwrap();
            inner.status.api_base = Some("http://localhost:8081".into());
            inner.status.worker_base = Some("http://localhost:3001".into());
            inner.status.token = None;
            inner.status.warning = Some("Bản dev: dùng backend :8081 và worker :3001 đang chạy sẵn".into());
            inner.status.phase = Phase::Ready;
            return Ok(());
        }
        return Err("Bản cài thiếu thành phần backend, vui lòng cài lại ứng dụng.".into());
    }

    let p = Paths { logs: data.join("logs"), res, data };
    for dir in [&p.logs, &p.data.join("backend"), &p.data.join("db")] {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let node = p.res.join("node").join(exe("node"));
    let java = p.res.join("jre").join("bin").join(exe("java"));
    ensure_executable(&node);
    ensure_executable(&java);
    let worker_updated = sync_worker(&p, services)?;
    if let Err(e) = ensure_chromium(&p, &node, worker_updated, services) {
        services.warn(e);
    }

    services.set(Phase::Starting, "Đang khởi động dịch vụ...");
    wait_port_free(BACKEND_PORT)?;
    wait_port_free(WORKER_PORT)?;

    let token = random_token();
    let worker_token = random_token();
    let jwt_secret = jwt_secret(&p.data)?;
    let hwid = crate::hwid::get_hardware_id()?;
    let backend_url = format!("http://127.0.0.1:{BACKEND_PORT}");
    let worker_url = format!("http://127.0.0.1:{WORKER_PORT}");
    let parent_pid = std::process::id().to_string();
    let ffmpeg = p.data.join("worker/node_modules/ffmpeg-static").join(exe("ffmpeg"));
    ensure_executable(&ffmpeg);

    let (out, err) = log_file(&p.logs, "backend.log")?;
    let backend = hide_window(
        Command::new(&java)
            .args(["-Xmx1024m", "-Dfile.encoding=UTF-8", "-jar"])
            .arg(p.res.join("backend.jar"))
            .arg("--spring.profiles.active=desktop")
            .env("PORT", BACKEND_PORT.to_string())
            .env("APP_DATA_DIR", &p.data)
            .env("WORKER_BASE_URL", &worker_url)
            .env("DESKTOP_SESSION_TOKEN", &token)
            .env("DESKTOP_WORKER_TOKEN", &worker_token)
            .env("APP_JWT_SECRET", &jwt_secret)
            .env("LICENSE_PUBLIC_KEY", crate::license::PUBLIC_KEY)
            .env("DESKTOP_HWID", &hwid)
            .env("PARENT_PID", &parent_pid)
            .env("FFMPEG_PATH", &ffmpeg)
            .current_dir(p.data.join("backend"))
            .stdout(out)
            .stderr(err),
    )
    .spawn()
    .map_err(|e| format!("Không chạy được backend: {e}"))?;
    services.0.lock().unwrap().children.push(backend);

    let (out, err) = log_file(&p.logs, "worker.log")?;
    let worker = hide_window(
        Command::new(&node)
            .arg(p.data.join("worker/server.js"))
            .env("PORT", WORKER_PORT.to_string())
            .env("BIND_HOST", "127.0.0.1")
            .env("BACKEND_URL", &backend_url)
            .env("WORKER_PUBLIC_URL", &worker_url)
            .env("DESKTOP_SESSION_TOKEN", &token)
            .env("BACKEND_TOKEN", &worker_token)
            .env("PARENT_PID", &parent_pid)
            .env("PLAYWRIGHT_BROWSERS_PATH", p.data.join("ms-playwright"))
            .current_dir(p.data.join("worker"))
            .stdout(out)
            .stderr(err),
    )
    .spawn()
    .map_err(|e| format!("Không chạy được worker: {e}"))?;
    services.0.lock().unwrap().children.push(worker);

    wait_healthy(services, &p, &backend_url, &worker_url)?;

    let mut inner = services.0.lock().unwrap();
    inner.status.api_base = Some(backend_url);
    inner.status.worker_base = Some(worker_url);
    inner.status.token = Some(token);
    inner.status.phase = Phase::Ready;
    inner.status.message = "Sẵn sàng".into();
    Ok(())
}

fn wait_healthy(services: &Services, p: &Paths, backend_url: &str, worker_url: &str) -> Result<(), String> {
    let started = Instant::now();
    loop {
        {
            let mut inner = services.0.lock().unwrap();
            for (i, child) in inner.children.iter_mut().enumerate() {
                if let Ok(Some(code)) = child.try_wait() {
                    let (name, log) = if i == 0 { ("Backend", "backend.log") } else { ("Worker", "worker.log") };
                    return Err(format!("{name} dừng đột ngột ({code}).\n{}", log_tail(&p.logs.join(log))));
                }
            }
        }
        let ok = |url: String| http_status(&url) == Some(200);
        if ok(format!("{backend_url}/actuator/health")) && ok(format!("{worker_url}/api/health")) {
            return Ok(());
        }
        if started.elapsed() > STARTUP_TIMEOUT {
            return Err(format!("Dịch vụ khởi động quá lâu.\n{}", log_tail(&p.logs.join("backend.log"))));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// GET http://127.0.0.1:port/path trên luồng chặn, trả về mã HTTP (health check, không cần runtime async)
fn http_status(url: &str) -> Option<u16> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    let rest = url.strip_prefix("http://")?;
    let (host, path) = rest.split_once('/').map(|(h, p)| (h, format!("/{p}")))?;
    let mut stream = TcpStream::connect_timeout(&host.parse().ok()?, Duration::from_secs(2)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").ok()?;
    let mut buf = [0u8; 32];
    let n = stream.read(&mut buf).ok()?;
    String::from_utf8_lossy(&buf[..n]).split_whitespace().nth(1)?.parse().ok()
}

#[tauri::command]
pub fn services_start(app: AppHandle) -> Result<ServicesStatus, String> {
    // Chỉ chạy backend/worker khi bản quyền hợp lệ
    if !license::local_status(&app).valid {
        return Err("Chưa kích hoạt bản quyền".into());
    }
    let services = app.state::<Services>();
    {
        let mut inner = services.0.lock().unwrap();
        if matches!(inner.status.phase, Phase::Starting | Phase::Ready) {
            return Ok(inner.status.clone());
        }
        inner.status.phase = Phase::Starting;
        inner.status.message = "Đang chuẩn bị...".into();
        inner.status.warning = None;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let services = handle.state::<Services>();
        if let Err(e) = boot(&handle, &services) {
            eprintln!("[Sidecar] {e}");
            services.stop_all();
            services.set(Phase::Failed, e);
        }
    });
    Ok(services.0.lock().unwrap().status.clone())
}

#[tauri::command]
pub fn services_status(app: AppHandle) -> ServicesStatus {
    let mut status = app.state::<Services>().0.lock().unwrap().status.clone();
    // Không trao token khi bản quyền đã mất hiệu lực
    if !license::local_status(&app).valid {
        status.token = None;
    }
    status
}
