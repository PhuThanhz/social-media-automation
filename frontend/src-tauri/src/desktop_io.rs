//! Webview của Tauri không mở cửa sổ mới (target=_blank, window.open) và không tự tải file.
//! Frontend bản Desktop chuyển các thao tác đó sang đây:
//! - link ngoài → mở bằng trình duyệt mặc định
//! - link tải từ backend/worker local → tải về thư mục Downloads
//! - file tạo trong trang (blob, <a download>) → ghi thẳng vào Downloads

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::sidecar::Services;

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().download_dir()
        .or_else(|_| app.path().document_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Bỏ ký tự cấm trong tên file, không cho chứa đường dẫn
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').chars().take(150).collect::<String>();
    if trimmed.is_empty() { "tai-xuong".into() } else { trimmed }
}

/// "video.mp4" đã có → "video (1).mp4"
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Lấy tên file từ Content-Disposition (ưu tiên filename*=UTF-8'')
fn filename_from_disposition(value: &str) -> Option<String> {
    let star = value.split(';').map(str::trim).find_map(|p| p.strip_prefix("filename*=UTF-8''"));
    if let Some(enc) = star {
        let bytes = enc.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let Ok(b) = u8::from_str_radix(&enc[i + 1..i + 3], 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        return String::from_utf8(out).ok();
    }
    value
        .split(';')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("filename="))
        .map(|f| f.trim_matches('"').to_string())
}

fn is_loopback(url: &reqwest::Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]"))
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Link không hợp lệ".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel") {
        return Err("Chỉ mở được link http(s)".into());
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/// Tải file từ backend/worker local về Downloads, trả về đường dẫn đã lưu
#[tauri::command]
pub async fn download_url(app: AppHandle, url: String, filename: Option<String>) -> Result<String, String> {
    let token = app.state::<Services>().session_token();
    let path = download_into(&downloads_dir(&app)?, &url, token.as_deref(), filename).await?;
    Ok(path.to_string_lossy().into_owned())
}

async fn download_into(dir: &Path, url: &str, token: Option<&str>, filename: Option<String>) -> Result<PathBuf, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Link không hợp lệ".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Chỉ tải được link http(s)".into());
    }
    let mut req = reqwest::Client::new().get(parsed.clone());
    // Token phiên chỉ gửi cho backend/worker trên máy này
    if let (Some(token), true) = (token, is_loopback(&parsed)) {
        req = req.header("X-Session-Token", token);
    }
    let mut resp = req.send().await.map_err(|e| format!("Không tải được file: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Không tải được file ({status}): {}", body.chars().take(300).collect::<String>()));
    }
    let name = filename
        .filter(|n| !n.trim().is_empty())
        .or_else(|| {
            resp.headers()
                .get(reqwest::header::CONTENT_DISPOSITION)
                .and_then(|v| v.to_str().ok())
                .and_then(filename_from_disposition)
        })
        .or_else(|| parsed.path_segments().and_then(|mut s| s.next_back()).map(str::to_string))
        .unwrap_or_else(|| "tai-xuong".into());

    let path = unique_path(dir, &sanitize(&name));
    // Ghi vào file tạm rồi đổi tên, tránh để lại file dở dang khi lỗi giữa chừng
    let partial = path.with_extension("part");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => file.write_all(&chunk).map_err(|e| e.to_string())?,
                Ok(None) => break,
                Err(e) => {
                    drop(file);
                    let _ = std::fs::remove_file(&partial);
                    return Err(format!("Mất kết nối khi tải: {e}"));
                }
            }
        }
    }
    std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Lưu file do trang tạo ra (blob). Body = bytes, header x-filename = tên file (encodeURIComponent)
#[tauri::command]
pub fn save_download(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Dữ liệu file không hợp lệ".into());
    };
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(|v| filename_from_disposition(&format!("filename*=UTF-8''{v}")).unwrap_or_else(|| v.to_string()))
        .unwrap_or_else(|| "tai-xuong".into());
    let path = unique_path(&downloads_dir(&app)?, &sanitize(&name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Mở Finder/Explorer tới file vừa tải (chỉ trong thư mục Downloads)
#[tauri::command]
pub fn reveal_download(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let dir = downloads_dir(&app)?;
    if !path.starts_with(&dir) {
        return Err("Chỉ mở được file trong thư mục Downloads".into());
    }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_disposition() {
        let v = "attachment; filename=\"video.mp4\"; filename*=UTF-8''M%C3%A8o%20con.mp4";
        assert_eq!(filename_from_disposition(v).as_deref(), Some("Mèo con.mp4"));
        assert_eq!(filename_from_disposition("attachment; filename=\"a.log\"").as_deref(), Some("a.log"));
    }

    /// Server giả: trả 401 nếu thiếu token, có token thì trả file kèm Content-Disposition
    fn fake_server() -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(3) {
                let mut stream = stream.unwrap();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                let resp = if req.contains("x-session-token: secret") {
                    "HTTP/1.1 200 OK\r\nContent-Disposition: attachment; filename=\"v.mp4\"; filename*=UTF-8''M%C3%A8o.mp4\r\nContent-Length: 5\r\nConnection: close\r\n\r\nVIDEO"
                } else {
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: 22\r\nConnection: close\r\n\r\nSESSION_TOKEN_REQUIRED"
                };
                stream.write_all(resp.as_bytes()).unwrap();
            }
        });
        format!("http://{addr}/api/download-video?url=x")
    }

    #[tokio::test]
    async fn downloads_with_token_and_unique_names() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let dir = std::env::temp_dir().join(format!("tz-dl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let url = fake_server();

        let err = download_into(&dir, &url, None, None).await.unwrap_err();
        assert!(err.contains("401"), "{err}");

        let first = download_into(&dir, &url, Some("secret"), None).await.unwrap();
        assert_eq!(first.file_name().unwrap(), "Mèo.mp4");
        assert_eq!(std::fs::read(&first).unwrap(), b"VIDEO");

        let second = download_into(&dir, &url, Some("secret"), None).await.unwrap();
        assert_eq!(second.file_name().unwrap(), "Mèo (1).mp4");
        assert!(!dir.join("Mèo.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn token_never_sent_to_external_hosts() {
        let url = reqwest::Url::parse("https://example.com/a").unwrap();
        assert!(!is_loopback(&url));
        assert!(is_loopback(&reqwest::Url::parse("http://127.0.0.1:47001/x").unwrap()));
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize("  "), "tai-xuong");
        assert_eq!(sanitize("a:b?.mp4"), "a_b_.mp4");
    }
}
