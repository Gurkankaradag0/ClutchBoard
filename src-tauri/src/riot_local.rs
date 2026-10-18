//! Bridge to the local Riot Client: lockfile -> local entitlements -> pd/glz endpoints.
//! Read-only except the signed-in player's own settings (player-preferences). Never touches the
//! game process and has no gameplay endpoints (no agent select/lock).
//! Returns `Ok(None)` when Valorant isn't running and `Err(step + status + body)` on failures.

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;

/// Known-good client platform header (base64 JSON), same as RadiantConnect uses.
const PLATFORM: &str = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";

type R<T> = Result<T, String>;

pub struct RiotLocal {
    /// 127.0.0.1 only: the Riot Client uses a self-signed certificate.
    local: reqwest::Client,
    remote: reqwest::Client,
}

struct Session {
    port: String,
    basic: String,
    puuid: String,
    access: String,
    entitlements: String,
    region: String,
    shard: String,
    version: String,
}

/// Signed-in Riot Client account; Valorant may or may not be running.
struct Client {
    port: String,
    basic: String,
    puuid: String,
    access: String,
    entitlements: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    pub puuid: String,
    name: Option<String>,
    tag: Option<String>,
    pub game_running: bool,
}

const SETTINGS_TYPE: &str = "Ares.PlayerSettings";

#[derive(Serialize)]
pub struct LocalStatus {
    puuid: String,
    region: String,
    shard: String,
}

fn local_app_data() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

/// lockfile: `name:pid:port:password:protocol`
fn read_lockfile() -> Option<(String, String)> {
    let text =
        std::fs::read_to_string(local_app_data()?.join(r"Riot Games\Riot Client\Config\lockfile"))
            .ok()?;
    let parts: Vec<&str> = text.trim().split(':').collect();
    Some((parts.get(2)?.to_string(), parts.get(3)?.to_string()))
}

fn shooter_log() -> Option<String> {
    let log = std::fs::read(local_app_data()?.join(r"VALORANT\Saved\Logs\ShooterGame.log")).ok()?;
    Some(String::from_utf8_lossy(&log).into_owned())
}

/// Value after `prefix`, up to the first whitespace.
fn after<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let start = text.find(prefix)? + prefix.len();
    text[start..].split_whitespace().next()
}

fn shard_for(region: &str) -> &'static str {
    match region {
        "na" | "latam" | "br" => "na",
        "ap" => "ap",
        "kr" => "kr",
        _ => "eu",
    }
}

async fn body(res: reqwest::Response, what: &str) -> R<Value> {
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("{what}: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "{what} → HTTP {}: {}",
            status.as_u16(),
            text.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("{what}: JSON {e}"))
}

impl RiotLocal {
    pub fn new() -> Self {
        Self {
            local: reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(Duration::from_secs(5))
                .build()
                .expect("local client"),
            remote: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("remote client"),
        }
    }

    async fn local_get(&self, port: &str, basic: &str, path: &str) -> R<Value> {
        let res = self
            .local
            .get(format!("https://127.0.0.1:{port}{path}"))
            .header("Authorization", basic)
            .send()
            .await
            .map_err(|e| format!("local {path}: {e}"))?;
        body(res, &format!("local {path}")).await
    }

    /// `Ok(None)` when the Riot Client or Valorant isn't running. Tokens are local and cheap, so no caching.
    async fn session(&self) -> R<Option<Session>> {
        let Some((port, password)) = read_lockfile() else {
            return Ok(None);
        };
        let basic = format!("Basic {}", STANDARD.encode(format!("riot:{password}")));

        // The lockfile can outlive the client for a moment; treat connection errors as closed.
        let Ok(sessions) = self
            .local_get(&port, &basic, "/product-session/v1/external-sessions")
            .await
        else {
            return Ok(None);
        };
        // Riot Client open without a Valorant session.
        let Some(valorant) = sessions
            .as_object()
            .and_then(|o| o.values().find(|s| s["productId"] == "valorant"))
        else {
            return Ok(None);
        };
        let args: Vec<&str> = valorant
            .pointer("/launchConfiguration/arguments")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let arg = |key: &str| {
            args.iter()
                .find_map(|a| a.strip_prefix(key))
                .map(str::to_owned)
        };
        let region = arg("-ares-deployment=")
            .unwrap_or_else(|| "eu".into())
            .to_lowercase();
        // -config-endpoint=https://shared.eu.a.pvp.net → "eu"
        let shard = arg("-config-endpoint=")
            .and_then(|e| e.split('.').nth(1).map(str::to_owned))
            .unwrap_or_else(|| shard_for(&region).into());

        let ent = self
            .local_get(&port, &basic, "/entitlements/v1/token")
            .await?;
        let log = shooter_log();
        let version = match log
            .as_deref()
            .and_then(|l| after(l, "CI server version: "))
            .map(str::to_owned)
            .or_else(|| valorant["version"].as_str().map(str::to_owned))
            .filter(|v| v.starts_with("release-"))
        {
            Some(v) => v,
            None => {
                let res = self
                    .remote
                    .get("https://valorant-api.com/v1/version")
                    .send()
                    .await
                    .map_err(|e| format!("version: {e}"))?;
                body(res, "valorant-api version").await?["data"]["riotClientVersion"]
                    .as_str()
                    .ok_or("client version not found")?
                    .to_owned()
            }
        };

        let field = |k: &str| {
            ent[k]
                .as_str()
                .map(str::to_owned)
                .ok_or(format!("missing '{k}' in entitlements response"))
        };
        Ok(Some(Session {
            puuid: field("subject")?,
            access: field("accessToken")?,
            entitlements: field("token")?,
            port,
            basic,
            region,
            shard,
            version,
        }))
    }

    fn pd(s: &Session, path: &str) -> String {
        format!("https://pd.{}.a.pvp.net{path}", s.shard)
    }

    fn glz(s: &Session, path: &str) -> String {
        // The "tr" deployment is served by the eu glz host.
        let region = if s.region == "tr" { "eu" } else { &s.region };
        format!("https://glz-{region}-1.{}.a.pvp.net{path}", s.shard)
    }

    /// pd/glz headers. Cloudflare rejects requests without a User-Agent (error 1010).
    fn authed(&self, req: reqwest::RequestBuilder, s: &Session) -> reqwest::RequestBuilder {
        req.bearer_auth(&s.access)
            .header("X-Riot-Entitlements-JWT", &s.entitlements)
            .header("X-Riot-ClientVersion", &s.version)
            .header("X-Riot-ClientPlatform", PLATFORM)
            .header(
                "User-Agent",
                "ShooterGame/13 Windows/10.0.19042.1.256.64bit",
            )
    }

    async fn get(&self, s: &Session, url: String) -> R<Value> {
        let what = url.split(".net").nth(1).unwrap_or(&url).to_owned();
        let res = self
            .authed(self.remote.get(&url), s)
            .send()
            .await
            .map_err(|e| format!("{what}: {e}"))?;
        body(res, &what).await
    }

    /// Signed-in account without requiring Valorant. `Ok(None)` when the client is closed or signed out.
    async fn client(&self) -> R<Option<Client>> {
        let Some((port, password)) = read_lockfile() else {
            return Ok(None);
        };
        let basic = format!("Basic {}", STANDARD.encode(format!("riot:{password}")));
        let Ok(ent) = self
            .local_get(&port, &basic, "/entitlements/v1/token")
            .await
        else {
            return Ok(None);
        };
        let field = |k: &str| {
            ent[k]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        };
        let (Some(puuid), Some(access), Some(entitlements)) =
            (field("subject"), field("accessToken"), field("token"))
        else {
            return Ok(None);
        };
        Ok(Some(Client {
            port,
            basic,
            puuid,
            access,
            entitlements,
        }))
    }

    async fn game_running(&self, c: &Client) -> bool {
        self.local_get(&c.port, &c.basic, "/product-session/v1/external-sessions")
            .await
            .ok()
            .and_then(|s| {
                s.as_object()
                    .map(|o| o.values().any(|v| v["productId"] == "valorant"))
            })
            .unwrap_or(false)
    }

    pub async fn client_status(&self) -> R<Option<ClientStatus>> {
        let Some(c) = self.client().await? else {
            return Ok(None);
        };
        let chat = self
            .local_get(&c.port, &c.basic, "/chat/v1/session")
            .await
            .unwrap_or(Value::Null);
        let text = |k: &str| {
            chat[k]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        };
        Ok(Some(ClientStatus {
            name: text("game_name"),
            tag: text("game_tag"),
            game_running: self.game_running(&c).await,
            puuid: c.puuid,
        }))
    }

    /// Settings hosts to try, best guess first. The PAS token carries the account's affinity.
    async fn settings_hosts(&self, c: &Client) -> Vec<String> {
        let affinity = match self
            .remote
            .get("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant")
            .bearer_auth(&c.access)
            .send()
            .await
        {
            Ok(res) => res.text().await.ok().and_then(|jwt| {
                let payload = URL_SAFE_NO_PAD
                    .decode(jwt.trim().split('.').nth(1)?)
                    .ok()?;
                serde_json::from_slice::<Value>(&payload).ok()?["affinity"]
                    .as_str()
                    .map(str::to_lowercase)
            }),
            Err(_) => None,
        };
        let prefix = match affinity.as_deref().unwrap_or("") {
            "eu" | "tr" => "euc1",
            "ap" | "kr" => "apse1",
            _ => "usw2",
        };
        let mut hosts = vec![
            format!("player-preferences-{prefix}.pp.sgp.pvp.net"),
            format!("{prefix}.pp.sgp.pvp.net"),
        ];
        if prefix != "usw2" {
            hosts.push("player-preferences-usw2.pp.sgp.pvp.net".into());
        }
        hosts
    }

    fn settings_req(&self, req: reqwest::RequestBuilder, c: &Client) -> reqwest::RequestBuilder {
        let req = req
            .bearer_auth(&c.access)
            .header("X-Riot-Entitlements-JWT", &c.entitlements)
            .header("X-Riot-ClientPlatform", PLATFORM)
            .header(
                "User-Agent",
                "ShooterGame/13 Windows/10.0.19042.1.256.64bit",
            );
        match shooter_log()
            .as_deref()
            .and_then(|l| after(l, "CI server version: "))
        {
            Some(v) => req.header("X-Riot-ClientVersion", v),
            None => req,
        }
    }

    /// Signed-in account's settings, decompressed: `{ puuid, settings }`.
    pub async fn settings_get(&self) -> R<Option<Value>> {
        let Some(c) = self.client().await? else {
            return Ok(None);
        };
        let mut errors = Vec::new();
        for host in self.settings_hosts(&c).await {
            let url = format!("https://{host}/playerPref/v3/getPreference/{SETTINGS_TYPE}");
            let envelope = match self.settings_req(self.remote.get(&url), &c).send().await {
                Ok(res) => match body(res, &host).await {
                    Ok(v) => v,
                    Err(e) => {
                        errors.push(e);
                        continue;
                    }
                },
                Err(e) => {
                    errors.push(format!("{host}: {e}"));
                    continue;
                }
            };
            // A fresh account has no saved settings yet.
            let Some(data) = envelope["data"].as_str().filter(|d| !d.is_empty()) else {
                return Ok(Some(json!({ "puuid": c.puuid, "settings": {} })));
            };
            let packed = STANDARD
                .decode(data)
                .map_err(|e| format!("settings base64: {e}"))?;
            let mut raw = Vec::new();
            DeflateDecoder::new(&packed[..])
                .read_to_end(&mut raw)
                .map_err(|e| format!("settings inflate: {e}"))?;
            let settings: Value =
                serde_json::from_slice(&raw).map_err(|e| format!("settings JSON: {e}"))?;
            return Ok(Some(json!({ "puuid": c.puuid, "settings": settings })));
        }
        Err(errors.join(" | "))
    }

    /// Replaces the signed-in account's settings. Refuses if another account is signed in.
    pub async fn settings_put(&self, puuid: &str, settings: &Value) -> R<()> {
        let c = self
            .client()
            .await?
            .ok_or("Riot Client is not signed in")?;
        if c.puuid != puuid {
            return Err("a different account is signed in".into());
        }
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&serde_json::to_vec(settings).map_err(|e| e.to_string())?)
            .map_err(|e| format!("settings deflate: {e}"))?;
        let packed = enc.finish().map_err(|e| format!("settings deflate: {e}"))?;
        let payload = json!({ "type": SETTINGS_TYPE, "data": STANDARD.encode(packed) });

        let mut errors = Vec::new();
        for host in self.settings_hosts(&c).await {
            let url = format!("https://{host}/playerPref/v3/savePreference");
            match self
                .settings_req(self.remote.put(&url), &c)
                .json(&payload)
                .send()
                .await
            {
                Ok(res) if res.status().is_success() => return Ok(()),
                Ok(res) => {
                    let status = res.status().as_u16();
                    let text = res.text().await.unwrap_or_default();
                    errors.push(format!(
                        "{host} → HTTP {status}: {}",
                        text.chars().take(200).collect::<String>()
                    ));
                }
                Err(e) => errors.push(format!("{host}: {e}")),
            }
        }
        Err(errors.join(" | "))
    }

    pub async fn status(&self) -> R<Option<LocalStatus>> {
        Ok(self.session().await?.map(|s| LocalStatus {
            puuid: s.puuid,
            region: s.region,
            shard: s.shard,
        }))
    }

    /// The signed-in player's equipped loadout.
    /// v2 now returns 404 RESOURCE_NOT_FOUND; v3 has the same shape.
    pub async fn my_loadout(&self) -> R<Option<Value>> {
        let Some(s) = self.session().await? else {
            return Ok(None);
        };
        let url = Self::pd(
            &s,
            &format!("/personalization/v3/players/{}/playerloadout", s.puuid),
        );
        let loadout = self.get(&s, url).await?;
        Ok(Some(
            json!({ "puuid": s.puuid, "region": s.region, "loadout": loadout }),
        ))
    }

    /// Current match (core-game, then pregame) with loadouts, names and parties. `Ok(None)` if not in a match.
    /// With `target`, tries another player's match. Riot may refuse that, in which case this returns `Ok(None)`.
    pub async fn live_match(&self, target: Option<String>) -> R<Option<Value>> {
        let Some(s) = self.session().await? else {
            return Ok(None);
        };
        let who = target.unwrap_or_else(|| s.puuid.clone());
        // Pregame only exposes your own team, so other players are checked in core-game only.
        let phases: &[&str] = if who == s.puuid {
            &["core-game", "pregame"]
        } else {
            &["core-game"]
        };
        for &phase in phases {
            // 404: not in this phase.
            let Ok(player) = self
                .get(&s, Self::glz(&s, &format!("/{phase}/v1/players/{who}")))
                .await
            else {
                continue;
            };
            let Some(id) = player["MatchID"].as_str() else {
                continue;
            };
            let m = match self
                .get(&s, Self::glz(&s, &format!("/{phase}/v1/matches/{id}")))
                .await
            {
                Ok(m) => m,
                Err(_) if who != s.puuid => return Ok(None),
                Err(e) => return Err(e),
            };
            let loadouts = self
                .get(
                    &s,
                    Self::glz(&s, &format!("/{phase}/v1/matches/{id}/loadouts")),
                )
                .await
                .unwrap_or(Value::Null);

            // pregame: AllyTeam.Players, core-game: Players
            let players: Vec<&Value> = m["Players"]
                .as_array()
                .or_else(|| m.pointer("/AllyTeam/Players").and_then(Value::as_array))
                .map(|v| v.iter().collect())
                .unwrap_or_default();
            // Incognito players are left out; they're looked up one at a time on request.
            let visible: Vec<&str> = players
                .iter()
                .filter(|p| p.pointer("/PlayerIdentity/Incognito") != Some(&Value::Bool(true)))
                .filter_map(|p| p["Subject"].as_str())
                .collect();
            let names = self.names(&s, &visible).await.unwrap_or(Value::Null);
            let parties = self.parties(&s).await;

            return Ok(Some(json!({
                "phase": phase, "puuid": s.puuid, "target": who, "region": s.region,
                "match": m, "loadouts": loadouts, "names": names, "parties": parties
            })));
        }
        Ok(None)
    }

    /// puuid -> partyId. Match data has no parties, so this combines your own party (glz)
    /// and friends' chat presences. Other players' parties can't be known.
    async fn parties(&self, s: &Session) -> Value {
        let mut out = Map::new();
        if let Ok(me) = self
            .get(s, Self::glz(s, &format!("/parties/v1/players/{}", s.puuid)))
            .await
        {
            if let Some(pid) = me["CurrentPartyID"].as_str() {
                if let Ok(party) = self
                    .get(s, Self::glz(s, &format!("/parties/v1/parties/{pid}")))
                    .await
                {
                    for m in party["Members"].as_array().into_iter().flatten() {
                        if let Some(sub) = m["Subject"].as_str() {
                            out.insert(sub.into(), pid.into());
                        }
                    }
                }
            }
        }
        if let Ok(p) = self
            .local_get(&s.port, &s.basic, "/chat/v4/presences")
            .await
        {
            for presence in p["presences"].as_array().into_iter().flatten() {
                let (Some(puuid), Some(private)) =
                    (presence["puuid"].as_str(), presence["private"].as_str())
                else {
                    continue;
                };
                let Some(data) = STANDARD
                    .decode(private)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                else {
                    continue;
                };
                // Older presences use `partyId`, newer ones `partyPresenceData.partyId`.
                let pid = data["partyId"]
                    .as_str()
                    .or_else(|| {
                        data.pointer("/partyPresenceData/partyId")
                            .and_then(Value::as_str)
                    })
                    .filter(|p| !p.is_empty());
                if let Some(pid) = pid {
                    out.entry(puuid.to_owned()).or_insert(pid.into());
                }
            }
        }
        Value::Object(out)
    }

    /// name-service is a read, but Riot exposes it as PUT.
    async fn names(&self, s: &Session, puuids: &[&str]) -> R<Value> {
        if puuids.is_empty() {
            return Ok(Value::Null);
        }
        let res = self
            .authed(self.remote.put(Self::pd(s, "/name-service/v2/players")), s)
            .json(puuids)
            .send()
            .await
            .map_err(|e| format!("name-service: {e}"))?;
        body(res, "name-service").await
    }

    /// Single-player name lookup, used as the last fallback for incognito players.
    pub async fn name(&self, puuid: &str) -> R<Option<Value>> {
        let Some(s) = self.session().await? else {
            return Ok(None);
        };
        let list = self.names(&s, &[puuid]).await?;
        Ok(list
            .as_array()
            .and_then(|a| a.first().cloned())
            .filter(|n| n["GameName"].as_str().is_some_and(|g| !g.is_empty())))
    }
}
