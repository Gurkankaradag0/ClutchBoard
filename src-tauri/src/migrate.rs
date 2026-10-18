//! One-time move of the data folders named after the old identifier (before 0.4.1) to the layout
//! set by `appDirectoriesOverride` in tauri.conf.json:
//!   %APPDATA%\ClutchBoard                settings, archive, game settings
//!   %LOCALAPPDATA%\ClutchBoard\WebView   WebView storage
//!   %LOCALAPPDATA%\ClutchBoard\Cache     Henrik cache
//! Must run before any window exists, or WebView2 starts with an empty folder.

use std::fs;
use std::path::{Path, PathBuf};

const OLD: &str = "com.ezentere.valotracker";
const APP: &str = "ClutchBoard";

pub fn run() {
    let dir = |var| std::env::var_os(var).map(PathBuf::from);
    if let (Some(roaming), Some(local)) = (dir("APPDATA"), dir("LOCALAPPDATA")) {
        migrate(&roaming, &local);
    }
}

fn migrate(roaming: &Path, local: &Path) {
    let (old, new) = (roaming.join(OLD), roaming.join(APP));
    if old.is_dir() && !new.exists() {
        let _ = fs::rename(&old, &new);
    }

    // Local\ClutchBoard can already be the install folder, so entries move one by one.
    let old = local.join(OLD);
    let Ok(entries) = fs::read_dir(&old) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name();
        let group = if name == "EBWebView" {
            "WebView"
        } else {
            "Cache"
        };
        let target = local.join(APP).join(group).join(&name);
        if target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(e.path(), &target);
    }
    // Only removed once empty.
    let _ = fs::remove_dir(&old);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("clutchboard-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_old_layout() {
        let (roaming, local) = (temp("roaming"), temp("local"));
        fs::create_dir_all(roaming.join(OLD).join("archive")).unwrap();
        fs::write(roaming.join(OLD).join("settings.json"), "{}").unwrap();
        fs::create_dir_all(local.join(OLD).join("EBWebView").join("Default")).unwrap();
        fs::create_dir_all(local.join(OLD).join("henrik")).unwrap();
        // Existing install folder with the app inside.
        fs::create_dir_all(local.join(APP)).unwrap();
        fs::write(local.join(APP).join("clutchboard.exe"), "").unwrap();

        migrate(&roaming, &local);

        assert!(roaming.join(APP).join("settings.json").is_file());
        assert!(roaming.join(APP).join("archive").is_dir());
        assert!(!roaming.join(OLD).exists());
        assert!(local
            .join(APP)
            .join("WebView")
            .join("EBWebView")
            .join("Default")
            .is_dir());
        assert!(local.join(APP).join("Cache").join("henrik").is_dir());
        assert!(local.join(APP).join("clutchboard.exe").is_file());
        assert!(!local.join(OLD).exists());
    }

    #[test]
    fn keeps_existing_new_data() {
        let (roaming, local) = (temp("roaming2"), temp("local2"));
        fs::create_dir_all(roaming.join(OLD)).unwrap();
        fs::write(roaming.join(OLD).join("settings.json"), "old").unwrap();
        fs::create_dir_all(roaming.join(APP)).unwrap();
        fs::write(roaming.join(APP).join("settings.json"), "new").unwrap();

        migrate(&roaming, &local);

        assert_eq!(
            fs::read_to_string(roaming.join(APP).join("settings.json")).unwrap(),
            "new"
        );
        assert!(roaming.join(OLD).exists());
    }
}
