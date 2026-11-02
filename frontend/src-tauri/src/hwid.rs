use sha2::{Digest, Sha256};

/// Lấy mã định danh máy (HWID) từ UUID hệ điều hành cấp cho máy.
/// Băm SHA-256 nên ổn định giữa các phiên bản Rust/app.
pub fn get_hardware_id() -> Result<String, String> {
    let raw = read_machine_uuid().ok_or("Không đọc được mã định danh máy")?;
    Ok(format_hwid(&raw))
}

#[cfg(target_os = "macos")]
fn read_machine_uuid() -> Option<String> {
    // IOPlatformUUID từ IOPlatformExpertDevice
    let out = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .find(|l| l.contains("IOPlatformUUID"))
        .and_then(|l| l.split('=').nth(1))
        .map(|v| v.trim().replace('"', ""))
        .filter(|v| !v.is_empty())
}

#[cfg(target_os = "windows")]
fn read_machine_uuid() -> Option<String> {
    // MachineGuid trong registry, đọc trực tiếp (không spawn powershell)
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        .ok()?;
    let guid: String = key.get_value("MachineGuid").ok()?;
    Some(guid.trim().to_string()).filter(|v| !v.is_empty())
}

#[cfg(target_os = "linux")]
fn read_machine_uuid() -> Option<String> {
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn read_machine_uuid() -> Option<String> {
    None
}

/// ZT-XXXX-XXXX-XXXX-XXXX từ SHA-256(uuid + salt)
fn format_hwid(raw: &str) -> String {
    let digest = Sha256::digest(format!("{}-zutter-salt-2026", raw.to_lowercase()).as_bytes());
    format!(
        "ZT-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}",
        digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7]
    )
}
