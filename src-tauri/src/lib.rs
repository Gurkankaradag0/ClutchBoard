mod archive;
mod henrik;
mod riot_local;

use archive::Archive;
use henrik::{ApiError, Henrik};
use riot_local::{LocalStatus, RiotLocal};
use serde_json::Value;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            storage_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
