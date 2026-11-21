use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::hwid;

const SERVER_URL: &str = env!("LICENSE_SERVER_URL");
pub const PUBLIC_KEY: &str = env!("LICENSE_PUBLIC_KEY");
/// Cho phép lệch đồng hồ tối đa 5 phút so với server
const CLOCK_SKEW_SECS: i64 = 300;
const HEARTBEAT: Duration = Duration::from_secs(15);

/// Nội dung token do license server ký
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claims {
    pub key: String,
    pub hwid: String,
    pub client: String,
    pub max_accounts: Option<i64>,
    pub license_exp: Option<i64>,
    pub iat: i64,
    pub exp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseState {
    pub valid: bool,
    /// Server trả lời dứt khoát là key bị khóa/hết hạn/sai máy
    pub revoked: bool,
    pub reason: Option<String>,
    pub info: Option<Claims>,
    pub hwid: Option<String>,
}

impl LicenseState {
    fn ok(claims: Claims, hwid: String) -> Self {
        Self { valid: true, revoked: false, reason: None, info: Some(claims), hwid: Some(hwid) }
    }
    fn invalid(reason: impl Into<String>, hwid: Option<String>) -> Self {
        Self { valid: false, revoked: false, reason: Some(reason.into()), info: None, hwid }
    }
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("license.tok"))
}

fn load_token(app: &AppHandle) -> Option<String> {
    let path = token_path(app).ok()?;
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn save_token(app: &AppHandle, token: &str) -> Result<(), String> {
    std::fs::write(token_path(app)?, token).map_err(|e| e.to_string())
}

fn delete_token(app: &AppHandle) {
    if let Ok(path) = token_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// Kiểm tra chữ ký Ed25519 và trả về claims (chưa kiểm tra thời hạn/HWID)
fn decode_signed(token: &str) -> Result<Claims, String> {
    let (payload_b64, sig_b64) = token.split_once('.').ok_or("Token sai định dạng")?;
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).map_err(|_| "Token sai định dạng")?;
    let sig = URL_SAFE_NO_PAD.decode(sig_b64).map_err(|_| "Token sai định dạng")?;
    let key_bytes: [u8; 32] = URL_SAFE_NO_PAD
        .decode(PUBLIC_KEY)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or("Public key nhúng trong app không hợp lệ")?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| "Public key nhúng trong app không hợp lệ")?;
    let sig = Signature::from_slice(&sig).map_err(|_| "Chữ ký bản quyền không hợp lệ")?;
    key.verify(&payload, &sig).map_err(|_| "Chữ ký bản quyền không hợp lệ")?;
    serde_json::from_slice(&payload).map_err(|_| "Token sai định dạng".into())
}

/// Kiểm tra đầy đủ: chữ ký, đúng máy, còn hạn license, còn hạn dùng offline
fn verify(token: &str, hwid: &str) -> Result<Claims, String> {
    let claims = decode_signed(token)?;
    let t = now();
    if claims.hwid != hwid {
        return Err("Bản quyền không thuộc về máy tính này".into());
    }
    if t + CLOCK_SKEW_SECS < claims.iat {
        return Err("Đồng hồ hệ thống không đúng, vui lòng chỉnh lại giờ máy".into());
    }
    if matches!(claims.license_exp, Some(exp) if t > exp) {
        return Err("Bản quyền đã hết hạn sử dụng".into());
    }
    if t > claims.exp {
        return Err("Đã quá thời gian dùng offline, vui lòng kết nối mạng để xác thực lại".into());
    }
    Ok(claims)
}

#[derive(Deserialize)]
struct ServerReply {
    success: Option<bool>,
    valid: Option<bool>,
    token: Option<String>,
    status: Option<String>,
    message: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Trạng thái từ token đã lưu, không gọi mạng
pub fn local_status(app: &AppHandle) -> LicenseState {
    let hwid = match hwid::get_hardware_id() {
        Ok(h) => h,
        Err(e) => return LicenseState::invalid(e, None),
    };
    let Some(token) = load_token(app) else {
        return LicenseState::invalid("Chưa kích hoạt bản quyền", Some(hwid));
    };
    match verify(&token, &hwid) {
        Ok(claims) => LicenseState::ok(claims, hwid),
        Err(e) => LicenseState::invalid(e, Some(hwid)),
    }
}

/// Gọi server làm mới token. Mất mạng thì dùng token cũ tới hết hạn offline.
pub async fn refresh(app: &AppHandle) -> LicenseState {
    let hwid = match hwid::get_hardware_id() {
        Ok(h) => h,
        Err(e) => return LicenseState::invalid(e, None),
    };
    let Some(token) = load_token(app) else {
        return LicenseState::invalid("Chưa kích hoạt bản quyền", Some(hwid));
    };
    let claims = match decode_signed(&token) {
        Ok(c) => c,
        Err(e) => {
            delete_token(app);
            return LicenseState::invalid(e, Some(hwid));
        }
    };

    let body = serde_json::json!({
        "licenseKey": claims.key,
        "hwid": hwid,
        "clientInfo": { "os": std::env::consts::OS, "app": app.package_info().version.to_string() },
    });
    let resp = match client() {
        Ok(c) => c.post(format!("{SERVER_URL}/api/license/ping")).json(&body).send().await,
        Err(e) => return LicenseState::invalid(e, Some(hwid)),
    };

    let reply = match resp {
        // 200 hoặc 404 là câu trả lời dứt khoát; 429/5xx coi như mất kết nối
        Ok(r) if r.status().is_success() || r.status() == reqwest::StatusCode::NOT_FOUND => {
            r.json::<ServerReply>().await.ok()
        }
        _ => None,
    };

    match reply {
        Some(ServerReply { valid: Some(true), token: Some(new_token), .. }) => match verify(&new_token, &hwid) {
            Ok(c) => {
                let _ = save_token(app, &new_token);
                LicenseState::ok(c, hwid)
            }
            Err(e) => LicenseState::invalid(e, Some(hwid)),
        },
        Some(r) if r.valid == Some(false) => {
            delete_token(app);
            let mut state = LicenseState::invalid(
                r.message.unwrap_or_else(|| format!("Bản quyền không còn hiệu lực ({})", r.status.unwrap_or_default())),
                Some(hwid),
            );
            state.revoked = true;
            state
        }
        _ => local_status(app),
    }
}

#[tauri::command]
pub fn get_device_hwid() -> Result<String, String> {
    hwid::get_hardware_id()
}

#[tauri::command]
pub fn license_status(app: AppHandle) -> LicenseState {
    local_status(&app)
}

#[tauri::command]
pub async fn license_refresh(app: AppHandle) -> LicenseState {
    refresh(&app).await
}

#[tauri::command]
pub async fn license_activate(app: AppHandle, key: String) -> Result<LicenseState, String> {
    let key = key.trim().to_uppercase();
    if key.is_empty() {
        return Err("Vui lòng nhập mã bản quyền (License Key)!".into());
    }
    let hwid = hwid::get_hardware_id()?;
    let body = serde_json::json!({
        "licenseKey": key,
        "hwid": hwid,
        "clientInfo": { "os": std::env::consts::OS, "app": app.package_info().version.to_string() },
    });
    let resp = client()?
        .post(format!("{SERVER_URL}/api/license/activate"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Không kết nối được máy chủ bản quyền. Kiểm tra mạng rồi thử lại.".to_string())?;
    let reply: ServerReply = resp
        .json()
        .await
        .map_err(|_| "Máy chủ bản quyền trả về dữ liệu không hợp lệ".to_string())?;

    match reply {
        ServerReply { success: Some(true), token: Some(token), .. } => {
            let claims = verify(&token, &hwid)?;
            save_token(&app, &token)?;
            Ok(LicenseState::ok(claims, hwid))
        }
        r => Err(r.message.unwrap_or_else(|| "Mã bản quyền không hợp lệ!".into())),
    }
}

#[tauri::command]
pub fn license_logout(app: AppHandle) {
    delete_token(&app);
}

/// Vòng kiểm tra định kỳ phía Rust: key bị khóa hoặc hết hạn offline thì báo UI rồi đóng app
pub fn spawn_guard(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT).await;
            if load_token(&app).is_none() {
                continue;
            }
            let state = refresh(&app).await;
            if !state.valid {
                eprintln!("[License Guard] {}", state.reason.clone().unwrap_or_default());
                let _ = app.emit("license-invalid", &state);
                tokio::time::sleep(Duration::from_secs(5)).await;
                app.state::<crate::sidecar::Services>().stop_all();
                std::process::exit(1);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // Chạy với LICENSE_TEST_TOKEN=<token thật từ server> cargo test
    #[test]
    fn verifies_server_token_and_rejects_tampering() {
        let Ok(token) = std::env::var("LICENSE_TEST_TOKEN") else { return };
        let hwid = hwid::get_hardware_id().unwrap();
        let claims = verify(&token, &hwid).expect("token thật phải hợp lệ");
        assert_eq!(claims.hwid, hwid);

        assert!(verify(&token, "ZT-0000-0000-0000-0000").is_err(), "sai máy phải bị từ chối");

        // Sửa payload (đổi hạn) mà giữ chữ ký cũ
        let (payload, sig) = token.split_once('.').unwrap();
        let mut json: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        json["exp"] = serde_json::json!(4_102_444_800i64);
        let forged = format!("{}.{}", URL_SAFE_NO_PAD.encode(json.to_string()), sig);
        assert!(verify(&forged, &hwid).is_err(), "token bị sửa phải bị từ chối");
    }
}
