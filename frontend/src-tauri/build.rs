use std::path::Path;

fn main() {
  println!("cargo:rerun-if-env-changed=LICENSE_SERVER_URL");
  println!("cargo:rerun-if-env-changed=LICENSE_PUBLIC_KEY");

  let release = std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false);
  let personal = std::env::var_os("CARGO_FEATURE_PERSONAL").is_some();

  // URL license server: bản release bắt buộc https, bản dev mặc định localhost
  let url = if personal { String::new() } else { match std::env::var("LICENSE_SERVER_URL") {
    Ok(u) if !u.trim().is_empty() => u.trim().trim_end_matches('/').to_string(),
    _ if release => panic!("Thiếu LICENSE_SERVER_URL khi build release (vd: LICENSE_SERVER_URL=https://license.example.com)"),
    _ => "http://localhost:5050".to_string(),
  }};
  if release && !personal && !url.starts_with("https://") {
    panic!("LICENSE_SERVER_URL phải là https:// khi build release");
  }

  // Public key Ed25519: env LICENSE_PUBLIC_KEY, hoặc đọc từ license-server/keys/public.b64
  let key_file = Path::new("../../license-server/keys/public.b64");
  println!("cargo:rerun-if-changed={}", key_file.display());
  let pubkey = if personal { String::new() } else { match std::env::var("LICENSE_PUBLIC_KEY") {
    Ok(k) if !k.trim().is_empty() => k.trim().to_string(),
    _ => std::fs::read_to_string(key_file)
      .map(|s| s.trim().to_string())
      .unwrap_or_else(|_| panic!("Thiếu LICENSE_PUBLIC_KEY (hoặc chạy license-server một lần để sinh keys/public.b64)")),
  }};

  // Bản release phải kèm backend/worker (chạy: node scripts/prepare-sidecar.mjs)
  println!("cargo:rerun-if-changed=sidecar/backend.jar");
  if release && !Path::new("sidecar/backend.jar").exists() {
    panic!("Thiếu sidecar/backend.jar — chạy `npm run sidecar:prepare` trong frontend/ trước khi build release");
  }
  std::fs::create_dir_all("sidecar").ok();

  println!("cargo:rustc-env=LICENSE_SERVER_URL={url}");
  println!("cargo:rustc-env=LICENSE_PUBLIC_KEY={pubkey}");

  tauri_build::build()
}
