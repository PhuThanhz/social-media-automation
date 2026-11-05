//! Local personal edition: no activation server, token file, or periodic license checks.
use serde::Serialize;
use tauri::AppHandle;

pub const PUBLIC_KEY: &str = "";

#[derive(Serialize)]
pub struct LicenseState {
    pub valid: bool,
    pub revoked: bool,
    pub reason: Option<String>,
    pub info: serde_json::Value,
    pub hwid: Option<String>,
}

pub fn local_status(_app: &AppHandle) -> LicenseState {
    LicenseState {
        valid: true,
        revoked: false,
        reason: None,
        info: serde_json::json!({
            "key": "PERSONAL", "hwid": "PERSONAL", "client": "Bản dùng riêng",
            "maxAccounts": null, "licenseExp": null, "iat": 0, "exp": 253402300799_i64
        }),
        hwid: None,
    }
}

#[tauri::command]
pub fn get_device_hwid() -> String { "PERSONAL".into() }

#[tauri::command]
pub fn license_status(app: AppHandle) -> LicenseState { local_status(&app) }

#[tauri::command]
pub async fn license_refresh(app: AppHandle) -> LicenseState { local_status(&app) }

#[tauri::command]
pub async fn license_activate(app: AppHandle, key: String) -> Result<LicenseState, String> {
    let _ = key;
    Ok(local_status(&app))
}

#[tauri::command]
pub fn license_logout(_app: AppHandle) {}

pub fn spawn_guard(_app: AppHandle) {}
