//! Standalone regression suite: compile with rustc --test and the built dunce rlib.
//! The ignored integration test uses TOOLZUTTER_SIDECAR_DIR, a bundled JRE and JAR.
#[path = "../src/runtime_paths.rs"]
mod runtime_paths;

#[cfg(windows)]
#[test]
#[ignore = "requires bundled JRE and backend.jar"]
fn bundled_java_starts_desktop_backend_from_normalized_installed_paths() {
    use runtime_paths::runtime_path;
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
    }

    let supplied = PathBuf::from(std::env::var_os("TOOLZUTTER_SIDECAR_DIR").expect("set TOOLZUTTER_SIDECAR_DIR"));
    let verbatim = fs::canonicalize(&supplied).unwrap();
    let resources = runtime_path(&verbatim);
    let java = resources.join("jre/bin/java.exe");
    // Demonstrate the actual regression using the same installed Java and JAR.
    let rejected = Command::new(&java).creation_flags(0x0800_0000)
        .arg("-jar").arg(verbatim.join("backend.jar")).output().unwrap();
    assert!(!rejected.status.success());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("trying to open file"));

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let temp = std::env::temp_dir().join(format!("ToolZutter path smoke Phú {}-{nonce}", std::process::id()));
    fs::create_dir_all(&temp).unwrap();
    let data = runtime_path(&fs::canonicalize(&temp).unwrap());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let log_path = data.join("backend-smoke.log");
    let log = File::create(&log_path).unwrap();
    let err = log.try_clone().unwrap();
    let mut child = OwnedChild(Command::new(&java).creation_flags(0x0800_0000)
        .args(["-Xmx512m", "-Dfile.encoding=UTF-8", "-jar"])
        .arg(resources.join("backend.jar")).arg("--spring.profiles.active=desktop")
        .arg("--logging.level.root=ERROR")
        .env("PORT", port.to_string()).env("APP_DATA_DIR", &data)
        .env("DESKTOP_PERSONAL", "true")
        .env("DESKTOP_SESSION_TOKEN", "path-smoke-session")
        .env("DESKTOP_WORKER_TOKEN", "path-smoke-worker")
        .env("WORKER_BASE_URL", "http://127.0.0.1:1")
        .env("PARENT_PID", std::process::id().to_string())
        .current_dir(&data).stdout(Stdio::from(log)).stderr(Stdio::from(err)).spawn().unwrap());

    let request = |path: &str, token: bool| -> std::io::Result<String> {
        let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(500))?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        let header = if token { "X-Session-Token: path-smoke-session\r\n" } else { "" };
        write!(stream, "GET {path} HTTP/1.1\r\nHost: localhost\r\n{header}Connection: close\r\n\r\n")?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response)
    };
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(code) = child.0.try_wait().unwrap() {
            panic!("Backend exited {code}: {}", fs::read_to_string(&log_path).unwrap());
        }
        if let Ok(response) = request("/actuator/health", false) {
            if response.starts_with("HTTP/1.1 200") && response.contains("\"status\":\"UP\"") { break; }
        }
        assert!(Instant::now() < deadline, "Backend startup timed out: {}", fs::read_to_string(&log_path).unwrap());
        std::thread::sleep(Duration::from_millis(250));
    }
    let setup = request("/api/desktop/setup-status", true).unwrap();
    assert!(setup.starts_with("HTTP/1.1 200"), "{setup}");
    assert!(setup.contains("\"needsSetup\":true"), "{setup}");
    assert!(setup.contains("\"personal\":true"), "{setup}");
    assert!(request("/api/desktop/setup-status", false).unwrap().starts_with("HTTP/1.1 401"));
    println!("Installed bundled Java: health UP, setup ready, session authentication enforced. Data: {}", data.display());
}
