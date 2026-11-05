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
