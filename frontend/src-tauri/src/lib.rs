mod desktop_io;
mod hwid;
#[cfg(not(feature = "personal"))]
mod license;
#[cfg(feature = "personal")]
#[path = "license_personal.rs"]
mod license;
mod sidecar;
mod runtime_paths;

use tauri::Manager;

#[tauri::command]
fn kill_application(app: tauri::AppHandle) {
    eprintln!("⚠️ [License Guard] Bản quyền đã bị thu hồi hoặc tài khoản bị khóa! Đang đóng ứng dụng...");
    app.exit(0);
}

#[tauri::command]
fn is_desktop_mode() -> bool {
    true
}

#[tauri::command]
fn set_interface_zoom(window: tauri::WebviewWindow, factor: f64) -> Result<(), String> {
    if !factor.is_finite() || !(0.5..=2.0).contains(&factor) {
        return Err("Độ phóng giao diện phải nằm trong khoảng 50% đến 200%.".into());
    }
    window.set_zoom(factor).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest dùng rustls không kèm provider; cài ring làm mặc định (bỏ qua nếu plugin khác đã cài)
    let _ = rustls::crypto::ring::default_provider().install_default();

    let app = tauri::Builder::default()
        .manage(sidecar::Services::new())
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            license::get_device_hwid,
            license::license_status,
            license::license_refresh,
            license::license_activate,
            license::license_logout,
            sidecar::services_start,
            sidecar::services_status,
            desktop_io::open_external,
            desktop_io::download_url,
            desktop_io::save_download,
            desktop_io::reveal_download,
            kill_application,
            set_interface_zoom,
            is_desktop_mode
        ])
        .setup(|app| {
            license::spawn_guard(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Tắt backend + worker cùng app (kể cả khi License Guard đóng app do bị thu hồi)
        if let tauri::RunEvent::Exit = event {
            app.state::<sidecar::Services>().stop_all();
        }
    });
}
