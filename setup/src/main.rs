//! One-click installer: shows a small branded window while the embedded NSIS installer runs
//! silently, then starts the app. The NSIS installer itself stays the update package.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const INSTALLER: &[u8] = include_bytes!(env!("CB_INSTALLER"));
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ClutchBoard";
const NO_WINDOW: u32 = 0x0800_0000;

/// Holds the extracted installer and this window's WebView data (see appDirectoriesOverride).
fn work_dir() -> PathBuf {
    std::env::temp_dir().join("ClutchBoardSetup")
}

fn installed_exe() -> Option<PathBuf> {
    let dir: String = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(UNINSTALL_KEY)
        .ok()?
        .get_value("InstallLocation")
        .ok()?;
    Some(PathBuf::from(dir.trim_matches('"')).join("clutchboard.exe")).filter(|p| p.is_file())
}

#[tauri::command]
fn version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn install() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        if INSTALLER.is_empty() {
            return Err("no installer embedded".to_string());
        }
        let dir = work_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let exe = dir.join("ClutchBoard-installer.exe");
        std::fs::write(&exe, INSTALLER).map_err(|e| e.to_string())?;
        let status = Command::new(&exe)
            .arg("/S")
            .status()
            .map_err(|e| e.to_string());
        let _ = std::fs::remove_file(&exe);
        match status? {
            s if s.success() => Ok(()),
            s => Err(format!("installer exit code {}", s.code().unwrap_or(-1))),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Removes the work folder once the WebView has let go of it, then exits.
#[tauri::command]
fn quit(app: AppHandle) {
    let _ = Command::new("cmd")
        .args(["/C", "ping -n 4 127.0.0.1 >nul & rmdir /s /q"])
        .arg(work_dir())
        .creation_flags(NO_WINDOW)
        .spawn();
    app.exit(0);
}

#[tauri::command]
fn launch(app: AppHandle) -> Result<(), String> {
    let exe = installed_exe().ok_or("installed app not found")?;
    Command::new(exe).spawn().map_err(|e| e.to_string())?;
    quit(app);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![version, install, launch, quit])
        .run(tauri::generate_context!())
        .expect("error while running setup");
}
