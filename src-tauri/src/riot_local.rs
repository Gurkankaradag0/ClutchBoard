//! Bridge to the local Riot Client: lockfile -> local entitlements -> pd/glz endpoints.
//! Read-only except the signed-in player's own settings (player-preferences) and direct messages
//! the user types to a friend. Never touches the game process and has no gameplay endpoints
//! (no agent select/lock).
//! Returns `Ok(None)` when Valorant isn't running and `Err(step + status + body)` on failures.

use base64::{engine::general_purpose::STANDARD, Engine};
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
        let field = |k: &str| ent[k].as_str().filter(|v| !v.is_empty()).map(str::to_owned);
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

    /// player-preferences serves every region from each host (checked 2026-10); the rest are fallbacks.
    fn settings_hosts() -> Vec<String> {
        ["usw2", "euc1", "apse1"]
            .into_iter()
            .flat_map(|r| {
                [
                    format!("player-preferences-{r}.pp.sgp.pvp.net"),
                    format!("{r}.pp.sgp.pvp.net"),
                ]
            })
            .collect()
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

    /// The host holding the account's settings and the settings. `None` host: no settings saved
    /// anywhere yet (every region answered PLAYER_PREFERENCE_NOT_FOUND), e.g. a new account.
    async fn find_settings(&self, c: &Client) -> R<(Option<String>, Value)> {
        let mut errors = Vec::new();
        let mut not_found = false;
        for host in Self::settings_hosts() {
            let url = format!("https://{host}/playerPref/v3/getPreference/{SETTINGS_TYPE}");
            let envelope = match self.settings_req(self.remote.get(&url), c).send().await {
                Ok(res) => match body(res, &host).await {
                    Ok(v) => v,
                    Err(e) if e.contains("PLAYER_PREFERENCE_NOT_FOUND") => {
                        not_found = true;
                        continue;
                    }
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
            let Some(data) = envelope["data"].as_str().filter(|d| !d.is_empty()) else {
                return Ok((Some(host), json!({})));
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
            return Ok((Some(host), settings));
        }
        // Only when every host answered: an unreachable region could hold the real settings.
        if not_found && errors.is_empty() {
            return Ok((None, json!({})));
        }
        Err(errors.join(" | "))
    }

    /// Signed-in account's settings, decompressed: `{ puuid, settings }`.
    pub async fn settings_get(&self) -> R<Option<Value>> {
        let Some(c) = self.client().await? else {
            return Ok(None);
        };
        let (_, settings) = self.find_settings(&c).await?;
        Ok(Some(json!({ "puuid": c.puuid, "settings": settings })))
    }

    /// Replaces the signed-in account's settings. Refuses if another account is signed in.
    pub async fn settings_put(&self, puuid: &str, settings: &Value) -> R<()> {
        let c = self.client().await?.ok_or("Riot Client is not signed in")?;
        if c.puuid != puuid {
            return Err("a different account is signed in".into());
        }
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&serde_json::to_vec(settings).map_err(|e| e.to_string())?)
            .map_err(|e| format!("settings deflate: {e}"))?;
        let packed = enc.finish().map_err(|e| format!("settings deflate: {e}"))?;
        let payload = json!({ "type": SETTINGS_TYPE, "data": STANDARD.encode(packed) });

        // Write where the settings already are, so they don't end up in another region.
        let hosts = match self.find_settings(&c).await {
            Ok((Some(host), _)) => vec![host],
            _ => Self::settings_hosts(),
        };
        let mut errors = Vec::new();
        for host in hosts {
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

    // ---- Chat: friends and direct messages. Needs only the signed-in Riot Client. ----

    fn chat_link() -> Option<(String, String)> {
        let (port, password) = read_lockfile()?;
        Some((
            port,
            format!("Basic {}", STANDARD.encode(format!("riot:{password}"))),
        ))
    }

    /// `{ me, friends: [{ puuid, pid, gameName, gameTag, note, state, product, activity, party }] }`.
    /// Offline friends have no presence (`state` null). See `presence_summary`.
    pub async fn friends(&self) -> R<Option<Value>> {
        let Some((port, basic)) = Self::chat_link() else {
            return Ok(None);
        };
        let Ok(session) = self.local_get(&port, &basic, "/chat/v1/session").await else {
            return Ok(None);
        };
        if session["state"] != "connected" {
            return Ok(None);
        }
        let friends = self.local_get(&port, &basic, "/chat/v4/friends").await?;
        let presences = self
            .local_get(&port, &basic, "/chat/v4/presences")
            .await
            .unwrap_or(Value::Null);
        // A friend can have several presences (Riot Client, mobile, a game); show the most telling one.
        let rank = |p: &Value| match (p["state"].as_str(), p["product"].as_str()) {
            (Some("mobile"), _) => 0,
            (_, Some("riot_client")) => 1,
            (_, Some("ritoplus")) => 2,
            (_, Some("valorant")) => 4,
            _ => 3,
        };
        let presence = |puuid: &str| {
            presences["presences"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["puuid"] == puuid)
                .max_by_key(|p| rank(p))
        };
        let list: Vec<Value> = friends["friends"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|f| {
                let mut v = f["puuid"]
                    .as_str()
                    .and_then(presence)
                    .map(presence_summary)
                    .unwrap_or_else(|| json!({ "state": null, "product": null, "activity": null, "party": null, "queue": null }));
                for (k, from) in [("puuid", "puuid"), ("pid", "pid"), ("gameName", "game_name"), ("gameTag", "game_tag"), ("note", "note")] {
                    v[k] = f[from].clone();
                }
                v
            })
            .collect();
        Ok(Some(json!({ "me": session["puuid"], "friends": list })))
    }

    /// Signed-in chat session: your puuid and, while Valorant runs, its session loop state
    /// (`MENUS`, `PREGAME`, `INGAME`) from your own presence. None when signed out.
    pub async fn chat_session(&self) -> Option<(String, Option<String>)> {
        let (port, basic) = Self::chat_link()?;
        let session = self
            .local_get(&port, &basic, "/chat/v1/session")
            .await
            .ok()?;
        if session["state"] != "connected" {
            return None;
        }
        let me = session["puuid"].as_str()?.to_string();
        let presences = self
            .local_get(&port, &basic, "/chat/v4/presences")
            .await
            .unwrap_or_default();
        let state = presences["presences"].as_array().and_then(|list| {
            let mine = list
                .iter()
                .find(|p| p["puuid"] == me.as_str() && p["product"] == "valorant")?;
            let private = decode_presence_json(&mine["private"]);
            private
                .pointer("/matchPresenceData/sessionLoopState")
                .or(private.get("sessionLoopState"))?
                .as_str()
                .map(str::to_string)
        });
        Some((me, state))
    }

    /// Messages of one conversation (a friend's `pid`), or of every conversation.
    pub async fn messages(&self, cid: Option<&str>) -> R<Option<Value>> {
        let Some((port, basic)) = Self::chat_link() else {
            return Ok(None);
        };
        let path = match cid {
            // pids are `<puuid>@<region>.pvp.net`; no escaping needed for those characters.
            Some(cid)
                if cid
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-@.".contains(c)) =>
            {
                format!("/chat/v6/messages?cid={cid}")
            }
            Some(_) => return Err("invalid conversation id".into()),
            None => "/chat/v6/messages".into(),
        };
        match self.local_get(&port, &basic, &path).await {
            Ok(v) => Ok(Some(v["messages"].clone())),
            // The client closed between the lockfile read and the request.
            Err(e) if e.contains("error sending request") => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Sends a direct message the user typed. Only to a friend's `pid`, so nothing else
    /// (parties, match chat) can be written to.
    pub async fn send_message(&self, pid: &str, message: &str) -> R<()> {
        let message = message.trim();
        if message.is_empty() {
            return Err("empty message".into());
        }
        let Some((port, basic)) = Self::chat_link() else {
            return Err("Riot Client is not running".into());
        };
        let friends = self.local_get(&port, &basic, "/chat/v4/friends").await?;
        if !friends["friends"]
            .as_array()
            .is_some_and(|l| l.iter().any(|f| f["pid"] == pid))
        {
            return Err("not a friend".into());
        }
        let res = self
            .local
            .post(format!("https://127.0.0.1:{port}/chat/v6/messages"))
            .header("Authorization", &basic)
            .json(&json!({ "cid": pid, "message": message, "type": "chat" }))
            .send()
            .await
            .map_err(|e| format!("send message: {e}"))?;
        body(res, "send message").await.map(|_| ())
    }
}

/// Base64 JSON from a presence; League double-encodes `private` as a JSON string.
fn decode_presence_json(b64: &Value) -> Value {
    let v = b64
        .as_str()
        .and_then(|s| STANDARD.decode(s).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .unwrap_or(Value::Null);
    match v.as_str() {
        Some(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        None => v,
    }
}

/// `{ state, product, activity, party }` from one chat presence.
/// - `product`: as Riot names it, plus `mobile` (Riot Mobile) and `tft`.
/// - `state`: chat | away | dnd. Riot Mobile is `product: ritoplus` while the app is open; the
///   legacy `state: mobile` stays after it's closed (reachable, not online), so that is "away".
/// - `activity`: lobby | queue | select | game, when the game says so.
/// - `party`: `[size, max]` when in a party of two or more.
/// - `queue`: Valorant queue id (`competitive`, `custom`) or `lol:<queueId>`.
fn presence_summary(p: &Value) -> Value {
    let mobile = p["state"] == "mobile";
    let state = if mobile {
        json!("away")
    } else {
        p["state"].clone()
    };
    let private = decode_presence_json(&p["private"]);
    // TFT runs inside the League client; its presence only differs by game mode.
    let product = match p["product"].as_str() {
        _ if mobile => json!("mobile"),
        Some("ritoplus") => json!("mobile"),
        Some("league_of_legends") if private["gameMode"] == "TFT" => json!("tft"),
        _ => p["product"].clone(),
    };
    let packed = decode_presence_json(&p["packedData"]);
    let activity = match p["product"].as_str() {
        Some("valorant") => {
            let loop_state = private
                .pointer("/matchPresenceData/sessionLoopState")
                .or(private.get("sessionLoopState"));
            let party_state = private
                .pointer("/partyPresenceData/partyState")
                .or(private.get("partyState"));
            match (
                loop_state.and_then(Value::as_str),
                party_state.and_then(Value::as_str),
            ) {
                (Some("INGAME"), _) => Some("game"),
                (Some("PREGAME"), _) => Some("select"),
                (_, Some("MATCHMAKING")) => Some("queue"),
                (Some("MENUS"), _) => Some("lobby"),
                _ => None,
            }
        }
        _ => match private["gameStatus"].as_str() {
            Some("inGame") => Some("game"),
            Some("championSelect") => Some("select"),
            Some("inQueue") => Some("queue"),
            Some("outOfGame" | "hosting_NORMAL" | "hosting_RANKED_SOLO_5x5") => Some("lobby"),
            _ => None,
        },
    };
    let num = |v: Option<&Value>| v.and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()));
    let size = num(packed.pointer("/party/currentSize"))
        .or_else(|| num(private.pointer("/partyPresenceData/partySize")))
        .or_else(|| num(private.get("partySize")));
    let max = num(packed.pointer("/party/maxSize"))
        .or_else(|| num(private.pointer("/partyPresenceData/maxPartySize")))
        .or_else(|| num(private.get("maxPartySize")));
    let party = match (size, max) {
        (Some(s), Some(m)) if s > 1 => json!([s, m]),
        _ => Value::Null,
    };
    // Valorant: queue id ("competitive"), custom games by provisioning flow.
    // League / TFT: numeric queue id, prefixed so the UI can tell them apart.
    let queue = match p["product"].as_str() {
        Some("valorant") => {
            let flow = private
                .pointer("/matchPresenceData/provisioningFlow")
                .or(private.get("provisioningFlow"));
            let id = private
                .pointer("/matchPresenceData/queueId")
                .or(private.get("queueId"))
                .and_then(Value::as_str)
                .filter(|q| !q.is_empty());
            match flow.and_then(Value::as_str) {
                Some("CustomGame") => Some("custom".to_string()),
                _ => id.map(str::to_string),
            }
        }
        Some("league_of_legends") => num(private.get("queueId"))
            .filter(|q| *q > 0)
            .map(|q| format!("lol:{q}")),
        _ => None,
    };
    json!({ "state": state, "product": product, "activity": activity, "party": party, "queue": queue })
}
