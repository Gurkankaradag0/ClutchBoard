//! In-game panels: separate always-on-top, transparent windows over the game. They are always
//! clickable but never take focus, so clicking them leaves the game focused. Chat windows
//! (`chat-<puuid>`) are the exception: they take focus when clicked so the user can type, and
//! sending or Esc hands it back to the last outside window (the game). Nothing touches the game
//! process; data comes from the same sources as the app.
//! Works over Valorant in "Windowed Fullscreen"; exclusive fullscreen can't be drawn over.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
    Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Panels the frontend knows (src/overlay/panels). Default hotkey per panel.
const PANELS: &[(&str, &str)] = &[("live", "ctrl+shift+KeyL"), ("friends", "ctrl+shift+KeyF")];
const PREFIX: &str = "overlay-";

pub struct Overlay {
    path: PathBuf,
    config: Mutex<Value>,
    /// Labels that should be on screen. Windows can hide a panel on its own (snapping
    /// rewrites the style), so this is what gets restored.
    shown: Mutex<HashSet<String>>,
}

/// Last foreground window of another process (the game), as a raw handle.
static OUTSIDE: AtomicIsize = AtomicIsize::new(0);

type WinEventProc = unsafe extern "system" fn(*mut c_void, u32, *mut c_void, i32, i32, u32, u32);

#[link(name = "user32")]
extern "system" {
    fn ShowWindow(hwnd: *mut c_void, cmd: i32) -> i32;
    fn IsWindowVisible(hwnd: *mut c_void) -> i32;
    fn GetForegroundWindow() -> *mut c_void;
    fn SetForegroundWindow(hwnd: *mut c_void) -> i32;
    fn SetWindowPos(
        hwnd: *mut c_void,
        after: *mut c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    fn SetWinEventHook(
        min: u32,
        max: u32,
        module: *mut c_void,
        callback: WinEventProc,
        process: u32,
        thread: u32,
        flags: u32,
    ) -> *mut c_void;
}
const SW_HIDE: i32 = 0;
const SW_SHOWNOACTIVATE: i32 = 4;
// NOSIZE | NOMOVE | NOZORDER | NOACTIVATE | FRAMECHANGED
const SWP_APPLY_STYLE: u32 = 0x1 | 0x2 | 0x4 | 0x10 | 0x20;
const EVENT_SYSTEM_FOREGROUND: u32 = 3;
// OUTOFCONTEXT (nothing is loaded into other processes) | SKIPOWNPROCESS
const WINEVENT_FLAGS: u32 = 0x0 | 0x2;

unsafe extern "system" fn on_foreground(
    _: *mut c_void,
    _: u32,
    hwnd: *mut c_void,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    OUTSIDE.store(hwnd as isize, Ordering::Relaxed);
}

/// Tracks the foreground window of other processes, so focus can go back to the game after
/// typing. Must run on a thread with a message loop (the main thread).
pub fn watch_foreground() {
    unsafe {
        OUTSIDE.store(GetForegroundWindow() as isize, Ordering::Relaxed);
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            std::ptr::null_mut(),
            on_foreground,
            0,
            0,
            WINEVENT_FLAGS,
        );
    }
}

/// Tauri's show() activates the window, which would take focus from the game.
fn show_quietly(window: &tauri::WebviewWindow) {
    window
        .state::<Overlay>()
        .shown
        .lock()
        .unwrap()
        .insert(window.label().into());
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0, SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = window.show();
        }
    }
    // The page keeps running while hidden; it pauses its polling on this.
    let _ = window.emit_to(window.label(), "overlay://visible", true);
}

/// Tauri's state doesn't follow show_quietly, so hiding goes through Windows too.
fn hide_quietly(window: &tauri::WebviewWindow) {
    window
        .state::<Overlay>()
        .shown
        .lock()
        .unwrap()
        .remove(window.label());
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0, SW_HIDE);
        },
        Err(_) => {
            let _ = window.hide();
        }
    }
    let _ = window.emit_to(window.label(), "overlay://visible", false);
}

/// Asks Windows: Tauri doesn't know about windows shown with show_quietly.
fn is_shown(window: &tauri::WebviewWindow) -> bool {
    window
        .hwnd()
        .map(|h| unsafe { IsWindowVisible(h.0) } != 0)
        .unwrap_or(false)
}

fn label(id: &str) -> String {
    format!("{PREFIX}{id}")
}

fn defaults() -> Value {
    let panels: serde_json::Map<String, Value> = PANELS
        .iter()
        .map(|(id, key)| ((*id).into(), json!({ "hotkey": key, "opacity": 0.85 })))
        .collect();
    json!({ "panels": panels })
}

impl Overlay {
    pub fn load(path: PathBuf) -> Self {
        let mut config = defaults();
        if let Some(saved) = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        {
            // Chat windows only keep their bounds here, so every saved entry is merged.
            for (id, p) in saved["panels"].as_object().into_iter().flatten() {
                for (k, v) in p.as_object().into_iter().flatten() {
                    config["panels"][id][k] = v.clone();
                }
            }
        }
        Self {
            path,
            config: Mutex::new(config),
            shown: Mutex::new(HashSet::new()),
        }
    }

    fn save(&self, config: &Value) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&self.path, config.to_string());
    }

    fn panel(&self, id: &str) -> Value {
        self.config.lock().unwrap()["panels"][id].clone()
    }
}

/// Requires Ctrl or Alt, so a game key (or Shift+letter in chat) is never taken.
fn parse(hotkey: &str) -> Result<Shortcut, String> {
    let lower = hotkey.to_lowercase();
    if !(lower.contains("ctrl") || lower.contains("control") || lower.contains("alt")) {
        return Err("needs Ctrl or Alt".into());
    }
    hotkey.parse::<Shortcut>().map_err(|e| e.to_string())
}

/// (Re)registers every hotkey from the config. Returns the ones the system refused.
pub fn register_all(app: &AppHandle) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let config = app.state::<Overlay>().config.lock().unwrap().clone();
    let bindings: Vec<(String, String)> = PANELS
        .iter()
        .filter_map(|(id, _)| {
            config["panels"][*id]["hotkey"]
                .as_str()
                .map(|k| ((*id).to_string(), k.to_string()))
        })
        .collect();
    let mut failed = Vec::new();
    for (target, key) in bindings {
        let Ok(shortcut) = parse(&key) else {
            failed.push(key);
            continue;
        };
        let res = gs.on_shortcut(shortcut, move |app, _, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            toggle(app, &target);
        });
        if res.is_err() {
            failed.push(key);
        }
    }
    failed
}

/// Per-player windows: `chat-<puuid>` (messages), `career-<puuid>` (rank + recent matches)
/// and `inventory-<puuid>` (a live match player's skins).
fn player_window(id: &str) -> Option<&'static str> {
    ["chat-", "career-", "inventory-"]
        .into_iter()
        .find(|prefix| {
            id.strip_prefix(prefix).is_some_and(|p| {
                !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            })
        })
}

fn create(app: &AppHandle, id: &str, title: &str) -> tauri::Result<()> {
    let panel = app.state::<Overlay>().panel(id);
    let b = &panel["bounds"];
    let kind = player_window(id);
    // New per-player windows cascade to the right of the panels.
    let open_chats = app
        .webview_windows()
        .keys()
        .filter(|l| kind.is_some_and(|k| l.starts_with(&label(k))))
        .count() as f64;
    // (default size, minimum size, first position), logical pixels.
    let step = open_chats * 28.0;
    let (size, min, pos) = match (kind, id) {
        (Some("chat-"), _) => ((340.0, 420.0), (260.0, 240.0), (500.0 + step, 220.0 + step)),
        (Some("career-"), _) => ((400.0, 560.0), (300.0, 300.0), (880.0 + step, 160.0 + step)),
        (Some(_), _) => (
            (1000.0, 700.0),
            (560.0, 360.0),
            (300.0 + step, 120.0 + step),
        ),
        (_, "friends") => ((320.0, 520.0), (240.0, 260.0), (24.0, 220.0)),
        _ => ((460.0, 560.0), (360.0, 280.0), (24.0, 220.0)),
    };
    let chat = kind == Some("chat-");
    let builder = WebviewWindowBuilder::new(app, label(id), WebviewUrl::App("overlay.html".into()))
        .title("ClutchBoard")
        .initialization_script(format!(
            "window.__OVERLAY__ = {}; window.__OVERLAY_TITLE__ = {};",
            json!(id),
            json!(title)
        ))
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        // Chat windows need keyboard focus to type; panels never take it.
        .focusable(chat)
        .resizable(true)
        // No maximize/minimize: snapping a panel to the screen edge would fill the screen.
        .maximizable(false)
        .minimizable(false)
        .min_inner_size(min.0, min.1)
        .visible(false)
        .inner_size(size.0, size.1)
        // First open: top left, clear of the minimap and the scoreboard.
        .position(pos.0, pos.1);
    let window = builder.build()?;
    if let (Some(x), Some(y), Some(w), Some(h)) = (
        b["x"].as_i64(),
        b["y"].as_i64(),
        b["w"].as_u64(),
        b["h"].as_u64(),
    ) {
        // Skip bounds saved from a maximized (negative corner) or shrunken window.
        let sf = window.scale_factor().unwrap_or(1.0);
        let valid = !(x < 0 && y < 0) && w as f64 >= min.0 * sf && h as f64 >= min.1 * sf;
        if valid {
            let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
            let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
        }
    }
    show(&window);
    Ok(())
}

/// First show of a new window. It keeps the standard frame until tao re-applies its style;
/// this makes it do that, and the frame change makes Windows redraw without one.
fn show(window: &tauri::WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    show_quietly(window);
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowPos(hwnd.0, std::ptr::null_mut(), 0, 0, 0, 0, SWP_APPLY_STYLE);
        }
    }
}

/// Watches the local Riot Client (127.0.0.1): every 2 s while signed in, 5 s otherwise.
/// - Valorant phase changes: agent select shows the live match panel, the match itself hides it
///   and the friends panel. Only on a change, so a hotkey still opens them mid-match.
/// - Signing out or switching accounts closes the chat windows (they belong to the old account).
pub fn watch_game(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_state = String::new();
        let mut last_me: Option<String> = None;
        // Signed out only after two misses in a row, so one slow reply doesn't close chats.
        let mut misses = 0;
        loop {
            let session = app
                .state::<crate::riot_local::RiotLocal>()
                .chat_session()
                .await;
            let wait = if session.is_some() { 2 } else { 5 };
            let (me, state) = match session {
                Some((me, state)) => (Some(me), state.unwrap_or_default()),
                None => (None, String::new()),
            };
            misses = if me.is_none() { misses + 1 } else { 0 };
            let switched = me.is_some() && last_me.is_some() && me != last_me;
            if switched || (misses == 2 && last_me.is_some()) {
                for (l, w) in app.webview_windows() {
                    if l.starts_with(&label("chat-")) {
                        hide_quietly(&w);
                        let _ = w.destroy();
                    }
                }
            }
            // A single miss changes nothing: neither the account nor the game phase.
            if me.is_none() && misses < 2 {
                tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                continue;
            }
            if me != last_me {
                // Signed in, out or another account: friends panels refresh right away.
                let _ = app.emit("overlay://session", ());
            }
            last_me = me;
            if state != last_state {
                match state.as_str() {
                    "PREGAME" => {
                        if let Some(w) = app.get_webview_window(&label("live")) {
                            show_quietly(&w);
                        } else {
                            let _ = create(&app, "live", "");
                        }
                    }
                    "INGAME" => {
                        for id in ["live", "friends"] {
                            if let Some(w) = app.get_webview_window(&label(id)).filter(is_shown) {
                                hide_quietly(&w);
                            }
                        }
                    }
                    _ => {}
                }
                last_state = state;
            }
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        }
    });
}

fn toggle(app: &AppHandle, id: &str) {
    match app.get_webview_window(&label(id)) {
        Some(w) if is_shown(&w) => hide_quietly(&w),
        Some(w) => show_quietly(&w),
        None => {
            let _ = create(app, id, "");
        }
    }
}

/// Remembers where a panel was moved or resized.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let Some(id) = window.label().strip_prefix(PREFIX) else {
        return;
    };
    if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
        return;
    }
    let overlay = window.state::<Overlay>();
    // Snapping or a style rewrite can hide a panel mid-drag; bring it back.
    if overlay.shown.lock().unwrap().contains(window.label()) {
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                if IsWindowVisible(hwnd.0) == 0 {
                    ShowWindow(hwnd.0, SW_SHOWNOACTIVATE);
                    SetWindowPos(hwnd.0, std::ptr::null_mut(), 0, 0, 0, 0, SWP_APPLY_STYLE);
                }
            }
        }
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let mut config = overlay.config.lock().unwrap();
    config["panels"][id]["bounds"] =
        json!({ "x": pos.x, "y": pos.y, "w": size.width, "h": size.height });
    overlay.save(&config);
}

#[tauri::command]
pub fn overlay_config(overlay: tauri::State<'_, Overlay>) -> Value {
    overlay.config.lock().unwrap().clone()
}

/// `target`: a panel id. `None` removes the hotkey.
#[tauri::command]
pub fn overlay_set_hotkey(
    app: AppHandle,
    target: String,
    hotkey: Option<String>,
) -> Result<(), String> {
    if let Some(k) = &hotkey {
        parse(k)?;
    }
    let overlay = app.state::<Overlay>();
    {
        let mut config = overlay.config.lock().unwrap();
        let value = hotkey.clone().map_or(Value::Null, Value::from);
        if PANELS.iter().any(|(id, _)| *id == target) {
            config["panels"][&target]["hotkey"] = value;
        } else {
            return Err("unknown panel".into());
        }
        overlay.save(&config);
    }
    let failed = register_all(&app);
    match hotkey {
        Some(k) if failed.contains(&k) => Err("in use".into()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn overlay_set_opacity(app: AppHandle, id: String, opacity: f64) {
    let overlay = app.state::<Overlay>();
    let mut config = overlay.config.lock().unwrap();
    config["panels"][&id]["opacity"] = json!(opacity.clamp(0.2, 1.0));
    overlay.save(&config);
    let _ = app.emit("overlay://config", ());
}

/// Async: creating a window inside a sync command deadlocks on Windows.
#[tauri::command]
pub async fn overlay_toggle(app: AppHandle, id: String) {
    toggle(&app, &id);
}

/// Shows a per-player window (see `player_window`), creating it if needed. Async for the same reason.
#[tauri::command]
pub async fn overlay_open(app: AppHandle, id: String, title: String) -> Result<(), String> {
    if player_window(&id).is_none() {
        return Err("unknown window".into());
    }
    match app.get_webview_window(&label(&id)) {
        Some(w) => {
            show_quietly(&w);
            Ok(())
        }
        None => create(&app, &id, &title).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle, id: String) {
    if let Some(w) = app.get_webview_window(&label(&id)) {
        hide_quietly(&w);
    }
}

/// Gives focus back to the game after typing, if one of our windows has it.
#[tauri::command]
pub fn overlay_release(app: AppHandle) {
    let outside = OUTSIDE.load(Ordering::Relaxed);
    let ours = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(PREFIX))
        .any(|(_, w)| {
            w.hwnd()
                .is_ok_and(|h| h.0 == unsafe { GetForegroundWindow() })
        });
    if ours && outside != 0 {
        unsafe {
            SetForegroundWindow(outside as *mut c_void);
        }
    }
}
