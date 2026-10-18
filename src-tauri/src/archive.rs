//! Per-player match archive under `app_data_dir/archive`.
//! `lists/<puuid>.json` holds ordered match ids per mode; `matches/<id>.json` is shared
//! between players. Deleting lists also removes matches no list references anymore.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub struct Archive {
    root: PathBuf,
}

/// Ids are hex + dashes only, so they can't escape the archive directory.
fn safe(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        Ok(id)
    } else {
        Err(format!("invalid id: {id}"))
    }
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn list_ids(lists: &Value) -> impl Iterator<Item = &str> {
    lists
        .as_object()
        .into_iter()
        .flat_map(|o| o.values())
        .filter_map(|l| l["ids"].as_array())
        .flatten()
        .filter_map(Value::as_str)
}

impl Archive {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn lists_dir(&self) -> PathBuf {
        self.root.join("lists")
    }

    fn matches_dir(&self) -> PathBuf {
        self.root.join("matches")
    }

    /// `{ lists, matches }` for a player, or `null` if there's no archive.
    pub fn load(&self, puuid: &str) -> Result<Value, String> {
        let Some(lists) = read_json(&self.lists_dir().join(format!("{}.json", safe(puuid)?)))
        else {
            return Ok(Value::Null);
        };
        let ids: HashSet<&str> = list_ids(&lists).collect();
        let matches: Vec<Value> = ids
            .into_iter()
            .filter_map(|id| {
                read_json(&self.matches_dir().join(format!("{}.json", safe(id).ok()?)))
            })
            .collect();
        Ok(json!({ "lists": lists, "matches": matches }))
    }

    /// Writes the lists and any match files that don't exist yet.
    pub fn save(&self, puuid: &str, lists: &Value, matches: &[Value]) -> Result<(), String> {
        let md = self.matches_dir();
        std::fs::create_dir_all(&md).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.lists_dir()).map_err(|e| e.to_string())?;
        for m in matches {
            let id = safe(
                m.pointer("/metadata/match_id")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )?;
            let path = md.join(format!("{id}.json"));
            if !path.exists() {
                std::fs::write(&path, serde_json::to_vec(m).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
        }
        let body = serde_json::to_vec(lists).map_err(|e| e.to_string())?;
        std::fs::write(
            self.lists_dir().join(format!("{}.json", safe(puuid)?)),
            body,
        )
        .map_err(|e| e.to_string())
    }

    /// Total archive size and the size of each group of players (matches counted once per group).
    pub fn usage(&self, groups: &[Vec<String>]) -> (u64, Vec<u64>) {
        let size = |p: PathBuf| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        let total: u64 = [self.lists_dir(), self.matches_dir()]
            .iter()
            .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
            .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
            .sum();
        let per = groups
            .iter()
            .map(|g| {
                let mut ids = HashSet::new();
                let mut bytes = 0;
                for p in g.iter().filter(|p| safe(p).is_ok()) {
                    let path = self.lists_dir().join(format!("{p}.json"));
                    bytes += size(path.clone());
                    if let Some(lists) = read_json(&path) {
                        ids.extend(list_ids(&lists).map(str::to_owned));
                    }
                }
                bytes
                    + ids
                        .iter()
                        .filter(|id| safe(id).is_ok())
                        .map(|id| size(self.matches_dir().join(format!("{id}.json"))))
                        .sum::<u64>()
            })
            .collect();
        (total, per)
    }

    /// Removes the lists, then any match file no remaining list points to.
    pub fn delete(&self, puuids: &[String]) -> Result<(), String> {
        for p in puuids {
            let _ = std::fs::remove_file(self.lists_dir().join(format!("{}.json", safe(p)?)));
        }
        let remaining: Vec<Value> = std::fs::read_dir(self.lists_dir())
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| read_json(&e.path()))
            .collect();
        let keep: HashSet<&str> = remaining.iter().flat_map(list_ids).collect();
        for e in std::fs::read_dir(self.matches_dir())
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = e.path();
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_owned();
            if !keep.contains(stem.as_str()) {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(())
    }
}
