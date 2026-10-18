//! HenrikDev client: API key, rate limiting (30/min), one retry on 429 and a TTL disk cache.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

/// 8-4-4-4-12 hex (puuid / match id).
fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

/// Expired files were only ignored on read and piled up on disk, so old ones are removed on startup.
const PRUNE_AFTER_SECS: u64 = 24 * 60 * 60;

fn prune(dir: &std::path::Path, max_age: Duration) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > max_age);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

const BASE: &str = "https://api.henrikdev.xyz/valorant/";

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ApiError {
    NoKey,
    NotFound { message: String },
    RateLimited { retry_after: u64 },
    Http { status: u16, message: String },
    Network { message: String },
}

struct Gate {
    remaining: i64,
    reset_at: Instant,
}

pub struct Henrik {
    http: reqwest::Client,
    key: RwLock<Option<String>>,
    gate: Mutex<Gate>,
    cache_dir: PathBuf,
    config_path: PathBuf,
}

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    hdev_api_key: Option<String>,
}

impl Henrik {
    pub fn new(cache_dir: PathBuf, config_path: PathBuf) -> Self {
        prune(&cache_dir, Duration::from_secs(PRUNE_AFTER_SECS));
        let saved = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .and_then(|s| s.hdev_api_key)
            .filter(|k| !k.is_empty());
        #[cfg(debug_assertions)]
        let saved = saved.or_else(|| {
            option_env!("HDEV_API_KEY_DEV")
                .map(str::to_owned)
                .filter(|k| !k.is_empty())
        });
        Self {
            http: reqwest::Client::builder()
                .user_agent(concat!("ClutchBoard/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(20))
                .build()
                .expect("reqwest client"),
            key: RwLock::new(saved),
            gate: Mutex::new(Gate {
                remaining: 30,
                reset_at: Instant::now(),
            }),
            cache_dir,
            config_path,
        }
    }

    pub async fn has_key(&self) -> bool {
        self.key.read().await.is_some()
    }

    pub async fn set_key(&self, key: String) -> Result<(), String> {
        let key = Some(key.trim().to_owned()).filter(|k| !k.is_empty());
        if let Some(dir) = self.config_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let body = serde_json::to_string(&Settings {
            hdev_api_key: key.clone(),
        })
        .map_err(|e| e.to_string())?;
        std::fs::write(&self.config_path, body).map_err(|e| e.to_string())?;
        *self.key.write().await = key;
        Ok(())
    }

    pub fn clear_cache(&self) -> Result<(), String> {
        match std::fs::remove_dir_all(&self.cache_dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }

    /// `<puuid>_<hash>.json` when the URL has a puuid, so a player's cache can be removed.
    fn cache_path(&self, url: &str) -> PathBuf {
        let mut h = DefaultHasher::new();
        url.hash(&mut h);
        let owner = url
            .split(['/', '?', '&', '='])
            .find(|seg| is_uuid(seg))
            .map(|u| format!("{u}_"))
            .unwrap_or_default();
        self.cache_dir
            .join(format!("{owner}{:016x}.json", h.finish()))
    }

    pub fn forget(&self, puuids: &[String]) {
        for e in std::fs::read_dir(&self.cache_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = e.file_name().to_string_lossy().into_owned();
            if puuids.iter().any(|p| name.starts_with(&format!("{p}_"))) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    /// (total bytes, bytes per puuid prefix)
    pub fn usage(&self) -> (u64, HashMap<String, u64>) {
        let mut total = 0;
        let mut per = HashMap::new();
        for e in std::fs::read_dir(&self.cache_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            total += size;
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some((owner, _)) = name.split_once('_') {
                *per.entry(owner.to_owned()).or_insert(0) += size;
            }
        }
        (total, per)
    }

    /// `ttl`: `None` never expires, `Some(0)` skips the cache.
    fn read_cache(&self, url: &str, ttl: Option<u64>) -> Option<Value> {
        if ttl == Some(0) {
            return None;
        }
        let path = self.cache_path(url);
        if let Some(ttl) = ttl {
            let age = std::fs::metadata(&path)
                .ok()?
                .modified()
                .ok()?
                .elapsed()
                .unwrap_or(Duration::MAX);
            if age > Duration::from_secs(ttl) {
                return None;
            }
        }
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
    }

    fn write_cache(&self, url: &str, body: &str) {
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let _ = std::fs::write(self.cache_path(url), body);
    }

    /// Waits for the window to reset (max 60s) when the quota is used up.
    async fn acquire(&self) {
        let mut gate = self.gate.lock().await;
        if gate.remaining <= 0 {
            let wait = gate
                .reset_at
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(60));
            tokio::time::sleep(wait).await;
            gate.remaining = 1;
        }
        gate.remaining -= 1;
    }

    async fn update_gate(&self, headers: &reqwest::header::HeaderMap) {
        let num = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<i64>().ok())
        };
        if let (Some(remaining), Some(reset)) =
            (num("x-ratelimit-remaining"), num("x-ratelimit-reset"))
        {
            let mut gate = self.gate.lock().await;
            gate.remaining = remaining;
            gate.reset_at = Instant::now() + Duration::from_secs(reset.max(0) as u64);
        }
    }

    pub async fn get(
        &self,
        path: &[String],
        query: &[(String, String)],
        ttl: Option<u64>,
        fresh: bool,
    ) -> Result<Value, ApiError> {
        let mut url = reqwest::Url::parse(BASE).expect("base url");
        url.path_segments_mut()
            .expect("base url")
            .pop_if_empty()
            .extend(path);
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        let url = url.to_string();

        if !fresh {
            if let Some(hit) = self.read_cache(&url, ttl) {
                return Ok(hit);
            }
        }
        let key = self.key.read().await.clone().ok_or(ApiError::NoKey)?;

        let mut attempt = 0;
        loop {
            attempt += 1;
            self.acquire().await;
            let res = self
                .http
                .get(&url)
                .header("Authorization", &key)
                .send()
                .await
                .map_err(|e| ApiError::Network {
                    message: e.without_url().to_string(),
                })?;
            self.update_gate(res.headers()).await;
            let status = res.status().as_u16();

            if status == 429 {
                let retry = ["x-ratelimit-reset", "retry-after"]
                    .iter()
                    .find_map(|h| res.headers().get(*h)?.to_str().ok()?.parse::<u64>().ok())
                    .unwrap_or(30);
                if attempt == 1 && retry <= 60 {
                    tokio::time::sleep(Duration::from_secs(retry)).await;
                    continue;
                }
                return Err(ApiError::RateLimited { retry_after: retry });
            }

            let body = res.text().await.map_err(|e| ApiError::Network {
                message: e.to_string(),
            })?;
            if !(200..300).contains(&status) {
                // Error body: {"errors":[{"message":"..."}]}
                let message = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| {
                        v.pointer("/errors/0/message")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .unwrap_or_default();
                return Err(if status == 404 {
                    ApiError::NotFound { message }
                } else {
                    ApiError::Http { status, message }
                });
            }
            let json: Value = serde_json::from_str(&body).map_err(|e| ApiError::Network {
                message: e.to_string(),
            })?;
            if ttl != Some(0) {
                self.write_cache(&url, &body);
            }
            return Ok(json);
        }
    }
}
