//! Start with Windows (HKCU Run, the value name the uninstaller removes) and the startup flow:
//! the splash window checks for updates, then shows the main window.

use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "ClutchBoard";
/// Passed by the Run entry; the window then starts minimized.
const LOGIN_ARG: &str = "--autostart";
/// Shows the main window anyway if the splash never reports back.
const SPLASH_TIMEOUT: Duration = Duration::from_secs(60);

pub struct Prefs(PathBuf);

fn launched_at_login() -> bool {
    std::env::args().any(|a| a == LOGIN_ARG)
}

/// Dev builds leave the registry alone.
fn set_run(on: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN_KEY)
        .map_err(|e| e.to_string())?;
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(RUN_NAME, &format!("\"{}\" {LOGIN_ARG}", exe.display()))
            .map_err(|e| e.to_string())
    } else {
        match key.delete_value(RUN_NAME) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

impl Prefs {
    /// On by default. The entry is rewritten each start so it follows the install folder.
    pub fn init(path: PathBuf) -> Self {
        let prefs = Self(path);
        let on = prefs.autostart();
        if !prefs.0.exists() {
            let _ = prefs.save(on);
        }
        let _ = set_run(on);
        prefs
    }

    fn autostart(&self) -> bool {
        std::fs::read(&self.0)
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["autostart"].as_bool())
            .unwrap_or(true)
    }

    fn save(&self, on: bool) -> Result<(), String> {
        if let Some(dir) = self.0.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.0, json!({ "autostart": on }).to_string()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn autostart_get(prefs: tauri::State<'_, Prefs>) -> bool {
    prefs.autostart()
}

#[tauri::command]
pub fn autostart_set(prefs: tauri::State<'_, Prefs>, on: bool) -> Result<(), String> {
    set_run(on)?;
    prefs.save(on)
}

fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        if launched_at_login() {
            let _ = main.minimize();
        } else {
            let _ = main.set_focus();
        }
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
}

/// Called by the splash once no update is pending.
#[tauri::command]
pub fn startup_done(app: AppHandle) {
    show_main(&app);
}

pub fn watch_splash(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SPLASH_TIMEOUT);
        let hidden = app
            .get_webview_window("main")
            .is_some_and(|m| !m.is_visible().unwrap_or(true));
        if hidden {
            show_main(&app);
        }
    });
}
