mod archive;
mod game_settings;
mod henrik;
mod migrate;
mod riot_local;
mod startup;

use archive::Archive;
use game_settings::Store;
use henrik::{ApiError, Henrik};
use riot_local::{ClientStatus, LocalStatus, RiotLocal};
use serde_json::Value;
use startup::Prefs;
use tauri::{Manager, State};

/// Generic HenrikDev GET. Each path segment is encoded separately.
/// TTLs are decided by the frontend (src/lib/api.ts).
#[tauri::command]
async fn henrik(
    state: State<'_, Henrik>,
    path: Vec<String>,
    query: Option<Vec<(String, String)>>,
    ttl: Option<u64>,
    fresh: Option<bool>,
) -> Result<Value, ApiError> {
    state
        .get(
            &path,
            &query.unwrap_or_default(),
            ttl,
            fresh.unwrap_or(false),
        )
        .await
}

#[tauri::command]
async fn api_key_status(state: State<'_, Henrik>) -> Result<bool, ()> {
    Ok(state.has_key().await)
}

#[tauri::command]
async fn set_api_key(state: State<'_, Henrik>, key: String) -> Result<(), String> {
    state.set_key(key).await
}

#[tauri::command]
fn clear_cache(state: State<'_, Henrik>) -> Result<(), String> {
    state.clear_cache()
}

// ---- Match archive ----

#[tauri::command]
fn archive_load(state: State<'_, Archive>, puuid: String) -> Result<Value, String> {
    state.load(&puuid)
}

#[tauri::command]
fn archive_save(
    state: State<'_, Archive>,
    puuid: String,
    lists: Value,
    matches: Vec<Value>,
) -> Result<(), String> {
    state.save(&puuid, &lists, &matches)
}

/// Drops the players' archives and their cached Henrik responses.
#[tauri::command]
fn forget_players(
    archive: State<'_, Archive>,
    henrik: State<'_, Henrik>,
    puuids: Vec<String>,
) -> Result<(), String> {
    henrik.forget(&puuids);
    archive.delete(&puuids)
}

/// Disk usage for the settings screen: cache, archive and per-group totals.
#[tauri::command]
fn storage_usage(
    archive: State<'_, Archive>,
    henrik: State<'_, Henrik>,
    groups: Vec<Vec<String>>,
) -> Value {
    let (cache_total, cache_per) = henrik.usage();
    let (archive_total, archive_per) = archive.usage(&groups);
    let groups: Vec<u64> = groups
        .iter()
        .zip(archive_per)
        .map(|(g, a)| {
            a + g
                .iter()
                .map(|p| cache_per.get(p).copied().unwrap_or(0))
                .sum::<u64>()
        })
        .collect();
    serde_json::json!({ "cache": cache_total, "archive": archive_total, "groups": groups })
}

// ---- Local Riot Client (read-only). Ok(None) when Valorant isn't running. ----

#[tauri::command]
async fn local_status(state: State<'_, RiotLocal>) -> Result<Option<LocalStatus>, String> {
    state.status().await
}

#[tauri::command]
async fn local_my_loadout(state: State<'_, RiotLocal>) -> Result<Option<Value>, String> {
    state.my_loadout().await
}

#[tauri::command]
async fn local_live_match(
    state: State<'_, RiotLocal>,
    puuid: Option<String>,
) -> Result<Option<Value>, String> {
    state.live_match(puuid).await
}

#[tauri::command]
async fn local_name(state: State<'_, RiotLocal>, puuid: String) -> Result<Option<Value>, String> {
    state.name(&puuid).await
}

// ---- Game settings: per-account config folders, signed-in account's cloud settings ----

#[tauri::command]
fn gs_accounts() -> Vec<game_settings::Account> {
    game_settings::accounts()
}

#[tauri::command]
fn gs_local_read(dir: String) -> Result<game_settings::LocalFiles, String> {
    game_settings::read_local(&dir)
}

/// Refused while Valorant runs on that account: the game rewrites these files on exit.
#[tauri::command]
async fn gs_local_write(
    riot: State<'_, RiotLocal>,
    dir: String,
    ini: Option<String>,
    gus: Option<String>,
) -> Result<(), String> {
    if let Some(c) = riot.client_status().await? {
        if c.game_running && dir.to_lowercase().starts_with(&c.puuid) {
            return Err("game running".into());
        }
    }
    game_settings::write_local(&dir, ini, gus)
}

/// Deletes the account's config folder and the app's snapshot and backups for it.
#[tauri::command]
async fn gs_delete_account(
    riot: State<'_, RiotLocal>,
    store: State<'_, Store>,
    dir: String,
    puuid: String,
) -> Result<(), String> {
    if let Some(c) = riot.client_status().await? {
        if c.game_running && c.puuid == puuid {
            return Err("game running".into());
        }
    }
    game_settings::delete_account(&dir)?;
    store.delete(&format!("snap-{puuid}"))?;
    store.delete(&format!("backup-{puuid}"))
}

#[tauri::command]
async fn gs_client(riot: State<'_, RiotLocal>) -> Result<Option<ClientStatus>, String> {
    riot.client_status().await
}

#[tauri::command]
async fn gs_cloud_get(riot: State<'_, RiotLocal>) -> Result<Option<Value>, String> {
    riot.settings_get().await
}

#[tauri::command]
async fn gs_cloud_put(
    riot: State<'_, RiotLocal>,
    puuid: String,
    settings: Value,
) -> Result<(), String> {
    riot.settings_put(&puuid, &settings).await
}

#[tauri::command]
fn gs_load(store: State<'_, Store>, name: String) -> Result<Value, String> {
    store.load(&name)
}

#[tauri::command]
fn gs_save(store: State<'_, Store>, name: String, value: Value) -> Result<(), String> {
    store.save(&name, &value)
}

/// Saves an export into the Downloads folder and returns its path.
#[tauri::command]
fn gs_export(app: tauri::AppHandle, file_name: String, content: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_.#".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let path = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join(safe);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    migrate::run();
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            let cache = app.path().app_cache_dir()?.join("henrik");
            let config = app.path().app_config_dir()?.join("settings.json");
            app.manage(Henrik::new(cache, config));
            app.manage(RiotLocal::new());
            app.manage(Archive::new(app.path().app_data_dir()?.join("archive")));
            app.manage(Store::new(app.path().app_data_dir()?.join("game-settings")));
            app.manage(Prefs::init(
                app.path().app_config_dir()?.join("startup.json"),
            ));
            startup::watch_splash(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            henrik,
            api_key_status,
            set_api_key,
            clear_cache,
            local_status,
            local_my_loadout,
            local_live_match,
            local_name,
            archive_load,
            archive_save,
            forget_players,
            storage_usage,
            gs_accounts,
            gs_local_read,
            gs_local_write,
            gs_delete_account,
            gs_client,
            gs_cloud_get,
            gs_cloud_put,
            gs_load,
            gs_save,
            gs_export,
            startup::autostart_get,
            startup::autostart_set,
            startup::startup_done
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
