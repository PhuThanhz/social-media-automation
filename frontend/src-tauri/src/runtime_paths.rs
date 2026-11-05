use std::path::{Path, PathBuf};

/// Tauri may return Windows verbatim paths (\\?\C:\...). Java's JAR loader
/// cannot open these even when the file exists. Use the compatible Windows
/// spelling for all runtime arguments, environment variables and working dirs.
pub fn runtime_path(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn installed_jar_path_loses_verbatim_prefix() {
        assert_eq!(runtime_path(Path::new(r"\\?\E:\ToolZutter Personal\sidecar\backend.jar")),
                   PathBuf::from(r"E:\ToolZutter Personal\sidecar\backend.jar"));
    }

    #[test]
    fn data_path_keeps_spaces_and_unicode() {
        assert_eq!(runtime_path(Path::new(r"\\?\C:\Users\Nguyễn Phú\AppData\Roaming\ToolZutter Personal")),
                   PathBuf::from(r"C:\Users\Nguyễn Phú\AppData\Roaming\ToolZutter Personal"));
    }

    #[test]
    fn regular_paths_stay_unchanged() {
        let path = Path::new(r"E:\ToolZutter Personal\sidecar");
        assert_eq!(runtime_path(path), path);
    }
}
