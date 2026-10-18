//! Window lifecycle: start with Windows (HKCU Run, the value name the uninstaller removes), the
//! splash that checks for updates before the main window shows, and the tray icon the close
//! button can minimize to.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent, Wry};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "ClutchBoard";
/// Passed by the Run entry.
const LOGIN_ARG: &str = "--autostart";
/// Shows the main window anyway if the splash never reports back.
const SPLASH_TIMEOUT: Duration = Duration::from_secs(60);

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

/// `startup.json`: `autostart` and `closeToTray`, both on by default (like Discord).
pub struct Prefs(PathBuf);

impl Prefs {
    /// The Run entry is rewritten each start so it follows the install folder.
    pub fn init(path: PathBuf) -> Self {
        let prefs = Self(path);
        if !prefs.0.exists() {
            let _ = prefs.write(&json!({ "autostart": true, "closeToTray": true }));
        }
        let _ = set_run(prefs.get("autostart"));
        prefs
    }

    fn read(&self) -> Value {
        std::fs::read(&self.0)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| json!({}))
    }

    fn get(&self, name: &str) -> bool {
        self.read()[name].as_bool().unwrap_or(true)
    }

    fn write(&self, v: &Value) -> Result<(), String> {
        if let Some(dir) = self.0.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.0, v.to_string()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn prefs_get(prefs: tauri::State<'_, Prefs>) -> Value {
    json!({ "autostart": prefs.get("autostart"), "closeToTray": prefs.get("closeToTray") })
}

#[tauri::command]
pub fn prefs_set(prefs: tauri::State<'_, Prefs>, name: String, on: bool) -> Result<(), String> {
    match name.as_str() {
        "autostart" => set_run(on)?,
        "closeToTray" => {}
        _ => return Err("unknown preference".into()),
    }
    let mut v = prefs.read();
    v[name] = json!(on);
    prefs.write(&v)
}

/// Brings the main window up from the tray, the taskbar or behind other windows.
pub fn reveal(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn show_main(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    if !launched_at_login() {
        return reveal(app);
    }
    // At login: stay in the tray, or sit minimized on the taskbar.
    if !app.state::<Prefs>().get("closeToTray") {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.minimize();
        }
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
        if app.get_webview_window("splash").is_some() {
            show_main(&app);
        }
    });
}

/// The close button hides the main window when closing to the tray is on.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && window.state::<Prefs>().get("closeToTray") {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// Tray menu items, relabeled by the frontend when the language changes.
pub struct TrayMenu {
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<TrayMenu> {
    let open = MenuItem::with_id(app, "open", "Open ClutchBoard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("ClutchBoard")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => reveal(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(TrayMenu { open, quit })
}

#[tauri::command]
pub fn tray_labels(menu: tauri::State<'_, TrayMenu>, open: String, quit: String) {
    let _ = menu.open.set_text(open);
    let _ = menu.quit.set_text(quit);
}
