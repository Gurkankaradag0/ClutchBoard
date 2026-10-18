//! Valorant per-account config folders (`%LOCALAPPDATA%\VALORANT\Saved\Config\<puuid>-<region>`)
//! and the app's own settings store (presets, snapshots, backups).

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const INI: &str = r"Windows\RiotUserSettings.ini";
const GUS: &str = r"WindowsClient\GameUserSettings.ini";

#[derive(Serialize)]
pub struct Account {
    dir: String,
    puuid: String,
    region: String,
    /// Last write to the account's config files, unix ms.
    modified: u64,
}

#[derive(Serialize)]
pub struct LocalFiles {
    ini: Option<String>,
    gus: Option<String>,
}

fn config_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join(r"VALORANT\Saved\Config"))
}

/// `<uuid>-<region>`; anything else (machine folders, `WindowsClient`) is skipped.
fn parse_dir(name: &str) -> Option<(String, String)> {
    let (puuid, region) = name.split_at_checked(36)?;
    let region = region.strip_prefix('-')?;
    let ok = puuid
        .chars()
        .enumerate()
        .all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
        && !region.is_empty()
        && region.chars().all(|c| c.is_ascii_alphanumeric());
    ok.then(|| (puuid.to_lowercase(), region.to_lowercase()))
}

fn account_dir(dir: &str) -> Result<PathBuf, String> {
    parse_dir(dir).ok_or("invalid account folder")?;
    Ok(config_root().ok_or("LOCALAPPDATA not set")?.join(dir))
}

fn modified(path: &PathBuf) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

pub fn accounts() -> Vec<Account> {
    let Some(root) = config_root() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut list: Vec<Account> = entries
        .flatten()
        .filter_map(|e| {
            let dir = e.file_name().to_string_lossy().into_owned();
            let (puuid, region) = parse_dir(&dir)?;
            let path = e.path();
            let modified = modified(&path.join(INI)).max(modified(&path.join(GUS)));
            Some(Account {
                dir,
                puuid,
                region,
                modified,
            })
        })
        .collect();
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    list
}

pub fn read_local(dir: &str) -> Result<LocalFiles, String> {
    let path = account_dir(dir)?;
    let read = |rel: &str| std::fs::read_to_string(path.join(rel)).ok();
    Ok(LocalFiles {
        ini: read(INI),
        gus: read(GUS),
    })
}

/// Writes through a temp file. The caller makes sure the game isn't running on this account.
pub fn write_local(dir: &str, ini: Option<String>, gus: Option<String>) -> Result<(), String> {
    let path = account_dir(dir)?;
    for (rel, text) in [(INI, ini), (GUS, gus)] {
        let Some(text) = text else { continue };
        let file = path.join(rel);
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{rel}: {e}"))?;
        }
        let tmp = file.with_extension("ini.tmp");
        std::fs::write(&tmp, text).map_err(|e| format!("{rel}: {e}"))?;
        // Players lock GameUserSettings.ini read-only (e.g. stretched resolution); keep the flag.
        let locked = std::fs::metadata(&file).is_ok_and(|m| m.permissions().readonly());
        let set_readonly = |on: bool| {
            if let Ok(meta) = std::fs::metadata(&file) {
                let mut perms = meta.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(on);
                let _ = std::fs::set_permissions(&file, perms);
            }
        };
        if locked {
            set_readonly(false);
        }
        let result = std::fs::rename(&tmp, &file).map_err(|e| format!("{rel}: {e}"));
        if locked {
            set_readonly(true);
        }
        result?;
    }
    Ok(())
}

/// Removes the account's config folder. Valorant recreates it on the next sign-in.
pub fn delete_account(dir: &str) -> Result<(), String> {
    let path = account_dir(dir)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

/// JSON documents under `app_data_dir/game-settings`.
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        let ok = !name.is_empty()
            && name.len() <= 80
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !ok {
            return Err("invalid name".into());
        }
        Ok(self.dir.join(format!("{name}.json")))
    }

    pub fn load(&self, name: &str) -> Result<Value, String> {
        match std::fs::read(self.path(name)?) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(_) => Ok(Value::Null),
        }
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        match std::fs::remove_file(self.path(name)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }

    pub fn save(&self, name: &str, value: &Value) -> Result<(), String> {
        let path = self.path(name)?;
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }
}
