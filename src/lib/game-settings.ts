import { invoke } from '@tauri-apps/api/core'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { defaultProfile, encodeCrosshair, sameCrosshair, type Profile, type ProfileData } from '@/lib/crosshair'

// Valorant keeps roaming settings (crosshair, keys, audio, mouse...) in Riot's cloud, readable and
// writable only for the account signed in to the Riot Client. Each account's config folder also
// caches them in RiotUserSettings.ini (no keybinds) next to machine-only video settings.
// So: video is written to the folder right away, cloud changes wait until that account signs in.

export const CATEGORIES = ['crosshair', 'keybinds', 'mouse', 'audio', 'video', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export type Entry = { settingEnum: string; value: boolean | number | string }
const ARRAYS = ['boolSettings', 'intSettings', 'floatSettings', 'stringSettings'] as const
type ArrayKey = (typeof ARRAYS)[number]
export type Blob = Partial<Record<ArrayKey, Entry[]>> & { actionMappings?: KeyBind[]; axisMappings?: unknown[]; [k: string]: unknown }
export type KeyBind = { name: string; characterName?: string; bindIndex?: number; key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean; tapHoldType?: string }
/** One binding slot; `key: 'None'` = explicitly unbound. */
export type Bind = { key: string; shift: boolean; ctrl: boolean; alt: boolean; cmd: boolean; tapHoldType: string }
/** Keybind edits. Agent profiles are named by `characterName`; 'None' is the general profile. */
export type KeyOp = { kind: 'set'; character: string; action: string; index: number; bind: Bind } | { kind: 'reset'; character: string; action: string } | { kind: 'addProfile'; character: string } | { kind: 'removeProfile'; character: string }
export const GENERAL = 'None'

/** Video settings from GameUserSettings.ini, by section. */
export type Gus = Record<string, Record<string, string>>
export type PresetData = { blob: Blob; gus?: Gus }
export type Preset = { id: string; name: string; createdAt: number; source?: { puuid: string; name?: string }; categories: Category[]; data: PresetData }
/** Edits to existing crosshair profiles, matched by name and code when applied (the list may have changed by then). */
export type CrosshairOp = { kind: 'update' | 'delete' | 'select'; match: { name: string; code: string }; profile?: Profile }
/** Single-setting edits; unlike presets, nothing else in the category changes. Removing = back to default. */
export type Patch = { set: Entry[]; remove: string[] }
export type Pending = { label: string; categories: Category[]; data: PresetData; at: number; ops?: CrosshairOp[]; patch?: Patch; keyOps?: KeyOp[] }

export type GsState = {
    presets: Preset[]
    defaultId?: string
    auto: { enabled: boolean; categories: Category[] }
    /** puuid -> id of the default preset last auto-applied to it. */
    applied: Record<string, string>
    pending: Record<string, Pending[]>
    excluded: string[]
    names: Record<string, { name: string; tag: string }>
    /** puuid -> when Henrik last had no name for it. */
    nameMisses: Record<string, number>
}

export type GsAccount = { dir: string; puuid: string; region: string; modified: number }
export type GsClient = { puuid: string; name: string | null; tag: string | null; gameRunning: boolean }
type LocalFiles = { ini: string | null; gus: string | null }
type Snapshot = { at: number; settings: Blob }
type Backup = { at: number; kind: 'cloud' | 'local'; settings?: Blob; ini?: string | null; gus?: string | null }

export const PROFILE_KEY = 'EAresStringSettingName::SavedCrosshairProfileData'
// 15 since patch 5.04.
export const MAX_PROFILES = 15
const MAX_BACKUPS = 5

// ---- Categories ----

export const settingName = (e: string) => e.slice(e.indexOf('::') + 2)

// Agent keybind profiles live next to actionMappings.
const PROFILE_LISTS = ['settingsProfiles', 'settingsProfileData'] as const

// Device handles, monitor ids, onboarding flags: never copied between accounts.
const MACHINE = /^(VoiceDevice\w*Handle|DefaultMonitorDeviceID|PreferredMonitorDeviceID|PreferredGamePods)$|^(HasSeen|HasAccepted|HasEver|HasCompleted|HasAcknowledged|LastSeen|LastAccepted)|Complete$/
const VIDEO = /Quality$|^AntiAliasing$|Anisotropic|Vignette|VSync|Clarity|Sharpen|Bloom|Distortion|Shadow|Reflex|Framerate|FrameRate|^MaxFPS|Gamma|Brightness|Letterbox|Resolution/

/** null = machine-specific. Only the profile list counts for crosshair; old flat keys are ignored. */
export const categoryOf = (settingEnum: string): Category | null => {
    const n = settingName(settingEnum)
    if (MACHINE.test(n)) return null
    if (settingEnum === PROFILE_KEY) return 'crosshair'
    if (/Crosshair/.test(n)) return null
    if (/^PlayerPerf/.test(n)) return 'other'
    if (/Volume|Music|^Mic|Voice|HRTF|Audio|Sound/.test(n)) return 'audio'
    if (/^Mouse|Sensitivity|^Gamepad|Invert/.test(n)) return 'mouse'
    if (VIDEO.test(n)) return 'video'
    return 'other'
}

const GUS_MAIN = '/Script/ShooterGame.ShooterGameUserSettings'
const GUS_KEYS = new Set(
    [
        'ResolutionSizeX',
        'ResolutionSizeY',
        'LastUserConfirmedResolutionSizeX',
        'LastUserConfirmedResolutionSizeY',
        'DesiredScreenWidth',
        'DesiredScreenHeight',
        'LastUserConfirmedDesiredScreenWidth',
        'LastUserConfirmedDesiredScreenHeight',
        'FullscreenMode',
        'LastConfirmedFullscreenMode',
        'PreferredFullscreenMode',
        'bShouldLetterbox',
        'bLastConfirmedShouldLetterbox',
        'bUseVSync',
        'bUseDynamicResolution',
        'FrameRateLimit',
        'bUseHDRDisplayOutput',
        'HDRDisplayOutputNits'
    ].map((k) => k.toLowerCase())
)
const gusWanted = (section: string, key: string) => section === 'ScalabilityGroups' || (section === GUS_MAIN && GUS_KEYS.has(key.toLowerCase()))

// ---- ini ----

const KIND: Record<string, ArrayKey> = { Bool: 'boolSettings', Int: 'intSettings', Float: 'floatSettings', String: 'stringSettings' }
const arrayOf = (settingEnum: string): ArrayKey | undefined => KIND[/^EAres(\w+?)SettingName::/.exec(settingEnum)?.[1] ?? '']
const LINE = /^(EAres(Bool|Int|Float|String)SettingName::[^=]+)=(.*)$/

const iniValue = (kind: ArrayKey, raw: string): Entry['value'] => {
    if (kind === 'boolSettings') return raw.toLowerCase() === 'true'
    if (kind !== 'stringSettings') return Number(raw)
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        try {
            return JSON.parse(raw) as string
        } catch {
            return raw.slice(1, -1)
        }
    }
    return raw
}

const iniText = (v: Entry['value']) => {
    if (typeof v === 'boolean') return v ? 'True' : 'False'
    if (typeof v === 'number') return String(v)
    return /["\\{}\n]|^\s|\s$/.test(v) ? JSON.stringify(v) : v
}

/** RiotUserSettings.ini -> settings blob (no keybinds). */
export const parseIni = (text: string): Blob => {
    const blob: Blob = {}
    for (const line of text.split(/\r?\n/)) {
        const m = LINE.exec(line.trim())
        if (!m) continue
        const kind = KIND[m[2]!]!
        ;(blob[kind] ??= []).push({ settingEnum: m[1]!, value: iniValue(kind, m[3]!) })
    }
    return blob
}

export const parseGus = (text: string): Gus => {
    const out: Gus = {}
    let section = ''
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        const s = /^\[(.+)\]$/.exec(line)
        if (s) {
            section = s[1]!
            continue
        }
        const eq = line.indexOf('=')
        if (eq < 1 || !gusWanted(section, line.slice(0, eq))) continue
        ;(out[section] ??= {})[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return out
}

/** Sets keys in an ini section in place (case-insensitive); null removes. Missing ones go at the section's end. */
const editIni = (text: string, section: string, values: Record<string, string | null>) => {
    const nl = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(/\r?\n/)
    const todo = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), [k, v] as const]))
    let current = ''
    let end = -1
    const out: string[] = []
    for (const line of lines) {
        const s = /^\[(.+)\]\s*$/.exec(line.trim())
        if (s) {
            if (current === section) end = out.length
            current = s[1]!
            out.push(line)
            continue
        }
        const eq = line.indexOf('=')
        const key = eq > 0 ? line.slice(0, eq).trim().toLowerCase() : ''
        const hit = current === section ? todo.get(key) : undefined
        if (!hit) {
            out.push(line)
            continue
        }
        todo.delete(key)
        if (hit[1] !== null) out.push(`${hit[0]}=${hit[1]}`)
    }
    if (current === section) end = out.length
    const add = [...todo.values()].filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`)
    if (!add.length) return out.join(nl)
    if (end === -1) return [...out, `[${section}]`, ...add].join(nl)
    // Keep blank lines that separate sections after the inserted keys.
    while (end > 0 && out[end - 1]!.trim() === '') end--
    out.splice(end, 0, ...add)
    return out.join(nl)
}

// ---- Settings blob ----

const entries = (blob: Blob) => ARRAYS.flatMap((k) => blob[k] ?? [])

export const readProfiles = (blob: Blob): ProfileData | null => {
    const v = blob.stringSettings?.find((e) => e.settingEnum === PROFILE_KEY)?.value
    if (typeof v !== 'string') return null
    try {
        const data = JSON.parse(v) as ProfileData
        return Array.isArray(data.profiles) ? data : null
    } catch {
        return null
    }
}

const writeProfiles = (blob: Blob, data: ProfileData) => {
    const list = (blob.stringSettings ??= []).filter((e) => e.settingEnum !== PROFILE_KEY)
    list.push({ settingEnum: PROFILE_KEY, value: JSON.stringify(data) })
    blob.stringSettings = list
}

export const currentProfile = (blob: Blob): Profile | undefined => {
    const d = readProfiles(blob)
    return d?.profiles[d.currentProfile] ?? d?.profiles[0]
}

/** Per-key union; the newer source wins. Keybinds only exist in the cloud copy. */
const combine = (ini: Blob | null, cloud: Snapshot | null, iniAt: number): Blob => {
    if (!cloud) return ini ?? {}
    if (!ini) return cloud.settings
    const [older, newer] = iniAt > cloud.at ? [cloud.settings, ini] : [ini, cloud.settings]
    const out: Blob = { ...cloud.settings }
    for (const k of ARRAYS) {
        const map = new Map<string, Entry>()
        for (const e of older[k] ?? []) map.set(e.settingEnum, e)
        for (const e of newer[k] ?? []) map.set(e.settingEnum, e)
        out[k] = [...map.values()]
    }
    return out
}

export type AccountView = { blob: Blob; gus: Gus; cloudAt: number | null; hasIni: boolean; hasKeybinds: boolean }

/** Only the parts of a view (or preset) in the given categories. */
export const pick = (view: { blob: Blob; gus?: Gus }, cats: Category[]): PresetData => {
    const blob: Blob = {}
    for (const k of ARRAYS) {
        const list = (view.blob[k] ?? []).filter((e) => {
            const c = categoryOf(e.settingEnum)
            return c !== null && cats.includes(c)
        })
        if (list.length) blob[k] = list
    }
    if (cats.includes('keybinds')) {
        if (view.blob.actionMappings) blob.actionMappings = view.blob.actionMappings
        if (view.blob.axisMappings) blob.axisMappings = view.blob.axisMappings
        for (const k of PROFILE_LISTS) if (view.blob[k]) blob[k] = view.blob[k]
    }
    return { blob, gus: cats.includes('video') && view.gus && Object.keys(view.gus).length ? view.gus : undefined }
}

/** Categories a preset actually has data for. */
export const presentCategories = (data: PresetData): Category[] => CATEGORIES.filter((c) => (c === 'keybinds' ? !!data.blob.actionMappings?.length : c === 'video' && data.gus ? true : entries(data.blob).some((e) => categoryOf(e.settingEnum) === c)))

export type CrosshairResult = 'added' | 'exists' | 'full'

/** Adds `profile` without touching existing ones and makes it current; reuses an identical one. */
export const addCrosshair = (blob: Blob, profile: Profile, fallbackName: string): CrosshairResult => {
    const data = readProfiles(blob) ?? { currentProfile: 0, profiles: [defaultProfile(fallbackName)] }
    const same = data.profiles.findIndex((p) => sameCrosshair(p, profile))
    let result: CrosshairResult
    if (same >= 0) {
        data.currentProfile = same
        result = 'exists'
    } else if (data.profiles.length >= MAX_PROFILES) {
        return 'full'
    } else {
        const names = new Set(data.profiles.map((p) => p.profileName))
        let name = profile.profileName || fallbackName
        for (let i = 2; names.has(name); i++) name = `${profile.profileName || fallbackName} (${i})`
        data.profiles.push({ ...structuredClone(profile), profileName: name })
        data.currentProfile = data.profiles.length - 1
        result = 'added'
    }
    writeProfiles(blob, data)
    return result
}

/** Replaces the target's settings in `cats` with the preset's; everything else stays. */
export const mergeSettings = (target: Blob, data: PresetData, cats: Category[], fallbackName: string) => {
    const blob = structuredClone(target)
    for (const k of ARRAYS) {
        const keep = (blob[k] ?? []).filter((e) => {
            const c = categoryOf(e.settingEnum)
            return c === null || c === 'crosshair' || !cats.includes(c)
        })
        const add = (data.blob[k] ?? []).filter((e) => {
            const c = categoryOf(e.settingEnum)
            return c !== null && c !== 'crosshair' && cats.includes(c)
        })
        blob[k] = [...keep, ...add]
    }
    if (cats.includes('keybinds') && data.blob.actionMappings) {
        blob.actionMappings = structuredClone(data.blob.actionMappings)
        if (data.blob.axisMappings) blob.axisMappings = structuredClone(data.blob.axisMappings)
        for (const k of PROFILE_LISTS) if (data.blob[k]) blob[k] = structuredClone(data.blob[k])
    }
    const profile = cats.includes('crosshair') ? currentProfile(data.blob) : undefined
    const crosshair = profile ? addCrosshair(blob, profile, fallbackName) : undefined
    return { blob, crosshair }
}

/** Video part written into the account's own files. Returns only the files that change. */
export const mergeLocal = (files: LocalFiles, data: PresetData) => {
    const out: { ini?: string; gus?: string } = {}
    const video = ARRAYS.flatMap((k) => (data.blob[k] ?? []).filter((e) => categoryOf(e.settingEnum) === 'video'))
    if (files.ini !== null && video.length) {
        const values: Record<string, string | null> = {}
        for (const e of entries(parseIni(files.ini))) if (categoryOf(e.settingEnum) === 'video') values[e.settingEnum] = null
        for (const e of video) values[e.settingEnum] = iniText(e.value)
        const ini = editIni(files.ini, 'Settings', values)
        if (ini !== files.ini) out.ini = ini
    }
    if (files.gus !== null && data.gus) {
        let gus = files.gus
        for (const [section, values] of Object.entries(data.gus)) gus = editIni(gus, section, Object.fromEntries(Object.entries(values).filter(([k]) => gusWanted(section, k))))
        if (gus !== files.gus) out.gus = gus
    }
    return out
}

// ---- Store ----

const load = <T>(name: string) => invoke<T | null>('gs_load', { name })
const save = (name: string, value: unknown) => invoke<void>('gs_save', { name, value })

const EMPTY: GsState = { presets: [], auto: { enabled: false, categories: ['crosshair', 'keybinds', 'mouse', 'audio', 'video', 'other'] }, applied: {}, pending: {}, excluded: [], names: {}, nameMisses: {} }

export const STATE_KEY = ['gs', 'state'] as const

export const useGsState = () => useQuery({ queryKey: STATE_KEY, queryFn: async () => ({ ...EMPTY, ...(await load<GsState>('state')) }), staleTime: Infinity })

/** Updates the cached state and persists it. */
export const updateState = async (qc: QueryClient, fn: (s: GsState) => GsState) => {
    const cur = qc.getQueryData<GsState>(STATE_KEY) ?? { ...EMPTY, ...(await load<GsState>('state')) }
    const next = fn(cur)
    qc.setQueryData(STATE_KEY, next)
    await save('state', next)
    return next
}

const pushBackup = async (puuid: string, b: Omit<Backup, 'at'>) => {
    const list = (await load<Backup[]>(`backup-${puuid}`)) ?? []
    await save(`backup-${puuid}`, [{ ...b, at: Date.now() }, ...list].slice(0, MAX_BACKUPS))
}

export const loadBackups = async (puuid: string) => (await load<Backup[]>(`backup-${puuid}`)) ?? []

export const useGsAccounts = () => useQuery({ queryKey: ['gs', 'accounts'], queryFn: () => invoke<GsAccount[]>('gs_accounts'), staleTime: 30_000 })

export const useGsClient = (poll: number | false) => useQuery({ queryKey: ['gs', 'client'], queryFn: () => invoke<GsClient | null>('gs_client'), refetchInterval: poll, staleTime: 3_000, refetchOnWindowFocus: true, retry: false })

/** Reads the signed-in account's cloud settings and keeps them as its snapshot. */
export const captureCloud = async (qc: QueryClient) => {
    const r = await invoke<{ puuid: string; settings: Blob } | null>('gs_cloud_get')
    if (!r) return null
    await save(`snap-${r.puuid}`, { at: Date.now(), settings: r.settings } satisfies Snapshot)
    void qc.invalidateQueries({ queryKey: ['gs', 'view', r.puuid] })
    return r
}

export const useAccountView = (account: GsAccount | undefined) =>
    useQuery({
        queryKey: ['gs', 'view', account?.puuid],
        enabled: !!account,
        queryFn: async (): Promise<AccountView> => {
            const [files, snap] = await Promise.all([invoke<LocalFiles>('gs_local_read', { dir: account!.dir }), load<Snapshot>(`snap-${account!.puuid}`)])
            const blob = combine(files.ini ? parseIni(files.ini) : null, snap, account!.modified)
            return { blob, gus: files.gus ? parseGus(files.gus) : {}, cloudAt: snap?.at ?? null, hasIni: files.ini !== null, hasKeybinds: !!blob.actionMappings?.length }
        }
    })

// ---- Apply ----

export type ApplyResult = { cloud: 'applied' | 'pending' | 'skipped'; local: 'applied' | 'blocked' | 'skipped'; crosshair?: CrosshairResult }

/** Cloud part for the signed-in account. Backs up the current settings first. */
export const applyCloud = async (qc: QueryClient, puuid: string, data: PresetData, cats: Category[], fallbackName: string, extra: { ops?: CrosshairOp[]; patch?: Patch; keyOps?: KeyOp[] } = {}) => {
    const { ops, patch, keyOps } = extra
    const cur = await invoke<{ puuid: string; settings: Blob } | null>('gs_cloud_get')
    if (!cur || cur.puuid !== puuid) throw new Error('account not signed in')
    await pushBackup(puuid, { kind: 'cloud', settings: cur.settings })
    const { blob, crosshair } = mergeSettings(cur.settings, data, cats, fallbackName)
    if (ops?.length && applyCrosshairOps(blob, ops) === 0) throw new Error('crosshair profile not found')
    if (patch) applyPatch(blob, patch)
    if (keyOps?.length) applyKeyOps(blob, keyOps)
    await invoke('gs_cloud_put', { puuid, settings: blob })
    await save(`snap-${puuid}`, { at: Date.now(), settings: blob } satisfies Snapshot)
    void qc.invalidateQueries({ queryKey: ['gs', 'view', puuid] })
    return crosshair
}

export const applyLocal = async (account: GsAccount, data: PresetData) => {
    const files = await invoke<LocalFiles>('gs_local_read', { dir: account.dir })
    const next = mergeLocal(files, data)
    if (!next.ini && !next.gus) return false
    await pushBackup(account.puuid, { kind: 'local', ini: files.ini, gus: files.gus })
    await invoke('gs_local_write', { dir: account.dir, ini: next.ini ?? null, gus: next.gus ?? null })
    return true
}

/**
 * Applies now what can be applied: video into the account's files, cloud settings if it's the
 * signed-in account. Otherwise the cloud part waits in `pending` until that account signs in.
 */
export const applyTo = async (qc: QueryClient, account: GsAccount, client: GsClient | null | undefined, data: PresetData, cats: Category[], label: string, fallbackName: string): Promise<ApplyResult> => {
    const res: ApplyResult = { cloud: 'skipped', local: 'skipped' }
    // Video lives in the files; it only goes to the cloud if the preset has video settings there too.
    const needsCloud = cats.some((c) => c !== 'video') || entries(data.blob).some((e) => categoryOf(e.settingEnum) === 'video')
    if (needsCloud) {
        if (client?.puuid === account.puuid) {
            res.crosshair = await applyCloud(qc, account.puuid, data, cats, fallbackName)
            res.cloud = 'applied'
        } else {
            await updateState(qc, (s) => ({ ...s, pending: { ...s.pending, [account.puuid]: [...(s.pending[account.puuid] ?? []), { label, categories: cats, data, at: Date.now() }] } }))
            res.cloud = 'pending'
        }
    }
    if (cats.includes('video')) {
        try {
            res.local = (await applyLocal(account, data)) ? 'applied' : 'skipped'
        } catch (e) {
            if (String(e).includes('game running')) res.local = 'blocked'
            else throw e
        }
    }
    void qc.invalidateQueries({ queryKey: ['gs', 'view', account.puuid] })
    return res
}

export const profileMatch = (p: Profile) => ({ name: p.profileName, code: encodeCrosshair(p) })

/** Applies ops in place; returns how many found their profile. The game needs at least one profile. */
export const applyCrosshairOps = (blob: Blob, ops: CrosshairOp[]) => {
    const data = readProfiles(blob)
    if (!data) return 0
    let done = 0
    for (const op of ops) {
        const i = data.profiles.findIndex((p) => p.profileName === op.match.name && encodeCrosshair(p) === op.match.code)
        if (i < 0) continue
        if (op.kind === 'update' && op.profile) data.profiles[i] = structuredClone(op.profile)
        else if (op.kind === 'select') data.currentProfile = i
        else if (op.kind === 'delete') {
            if (data.profiles.length <= 1) continue
            data.profiles.splice(i, 1)
            if (data.currentProfile > i) data.currentProfile--
            else if (data.currentProfile === i) data.currentProfile = 0
        }
        done++
    }
    writeProfiles(blob, data)
    return done
}

/** Crosshair edits: right away on the signed-in account, otherwise when it signs in. */
export const editCrosshairs = async (qc: QueryClient, account: GsAccount, client: GsClient | null | undefined, ops: CrosshairOp[], label: string) => {
    if (client?.puuid === account.puuid) {
        await applyCloud(qc, account.puuid, { blob: {} }, [], '', { ops })
        return 'applied' as const
    }
    await updateState(qc, (s) => ({ ...s, pending: { ...s.pending, [account.puuid]: [...(s.pending[account.puuid] ?? []), { label, categories: ['crosshair'], data: { blob: {} }, ops, at: Date.now() }] } }))
    return 'pending' as const
}

export const applyPatch = (blob: Blob, patch: Patch) => {
    const touched = new Set([...patch.set.map((e) => e.settingEnum), ...patch.remove])
    for (const k of ARRAYS) if (blob[k]) blob[k] = blob[k]!.filter((e) => !touched.has(e.settingEnum))
    for (const e of patch.set) {
        const k = arrayOf(e.settingEnum)
        if (k) (blob[k] ??= []).push(e)
    }
}

const mergePatch = (a: Patch, b: Patch): Patch => {
    const later = new Set([...b.set.map((e) => e.settingEnum), ...b.remove])
    return { set: [...a.set.filter((e) => !later.has(e.settingEnum)), ...b.set], remove: [...a.remove.filter((r) => !later.has(r)), ...b.remove] }
}

type ProfileEntry = { presetIndex: number; profileName: string }

export const agentProfiles = (blob: Blob) => (blob.settingsProfiles as string[] | undefined) ?? []

/** Applies keybind ops in place. A new agent profile starts as a copy of the general binds, like the game does. */
export const applyKeyOps = (blob: Blob, ops: KeyOp[]) => {
    let maps = [...(blob.actionMappings ?? [])]
    let profiles = [...agentProfiles(blob)]
    let data = [...((blob.settingsProfileData as ProfileEntry[] | undefined) ?? [])]
    const of = (m: KeyBind) => m.characterName ?? GENERAL
    for (const op of ops) {
        if (op.kind === 'set') {
            maps = maps.filter((m) => !(of(m) === op.character && m.name === op.action && (m.bindIndex ?? 0) === op.index))
            maps.push({ name: op.action, characterName: op.character, bindIndex: op.index, ...op.bind })
        } else if (op.kind === 'reset') {
            maps = maps.filter((m) => !(of(m) === op.character && m.name === op.action))
        } else if (op.kind === 'addProfile') {
            if (profiles.includes(op.character)) continue
            profiles.push(op.character)
            if (!data.some((d) => d.profileName === GENERAL)) data.unshift({ presetIndex: 0, profileName: GENERAL })
            // -1 is what the game stores for agent profiles with their own binds.
            data.push({ presetIndex: -1, profileName: op.character })
            maps.push(...maps.filter((m) => of(m) === GENERAL).map((m) => ({ ...m, characterName: op.character })))
        } else {
            profiles = profiles.filter((p) => p !== op.character)
            data = data.filter((d) => d.profileName !== op.character)
            maps = maps.filter((m) => of(m) !== op.character)
        }
    }
    blob.actionMappings = maps
    blob.settingsProfiles = profiles
    blob.settingsProfileData = data
}

/** Keybinds live only in the cloud: applied now on the signed-in account, otherwise when it signs in. */
export const editKeybinds = async (qc: QueryClient, account: GsAccount, client: GsClient | null | undefined, ops: KeyOp[], label: string) => {
    if (client?.puuid === account.puuid) {
        await applyCloud(qc, account.puuid, { blob: {} }, [], '', { keyOps: ops })
        return 'applied' as const
    }
    await updateState(qc, (s) => {
        const list = [...(s.pending[account.puuid] ?? [])]
        const i = list.findIndex((j) => j.keyOps)
        if (i >= 0) list[i] = { ...list[i]!, keyOps: [...list[i]!.keyOps!, ...ops], at: Date.now() }
        else list.push({ label, categories: [], data: { blob: {} }, keyOps: ops, at: Date.now() })
        return { ...s, pending: { ...s.pending, [account.puuid]: list } }
    })
    return 'pending' as const
}

export type EditResult = { cloud: 'applied' | 'pending' | 'none'; local: 'applied' | 'blocked' | 'none' }

/**
 * Edits single settings. The cloud copy is changed right away on the signed-in account, otherwise
 * queued (merged into one pending job). The account's local files are updated too, so the change shows.
 * `gus` holds GameUserSettings.ini values, which only exist locally.
 */
export const editSettings = async (qc: QueryClient, account: GsAccount, client: GsClient | null | undefined, patch: Patch, gus: Gus | null, label: string): Promise<EditResult> => {
    const res: EditResult = { cloud: 'none', local: 'none' }
    if (patch.set.length || patch.remove.length) {
        if (client?.puuid === account.puuid) {
            await applyCloud(qc, account.puuid, { blob: {} }, [], '', { patch })
            res.cloud = 'applied'
        } else {
            await updateState(qc, (s) => {
                const list = [...(s.pending[account.puuid] ?? [])]
                const i = list.findIndex((j) => j.patch && !j.ops && !j.categories.length)
                if (i >= 0) list[i] = { ...list[i]!, patch: mergePatch(list[i]!.patch!, patch), at: Date.now() }
                else list.push({ label, categories: [], data: { blob: {} }, patch, at: Date.now() })
                return { ...s, pending: { ...s.pending, [account.puuid]: list } }
            })
            res.cloud = 'pending'
        }
    }
    const files = await invoke<LocalFiles>('gs_local_read', { dir: account.dir })
    const next: { ini?: string; gus?: string } = {}
    if (files.ini !== null && (patch.set.length || patch.remove.length)) {
        const values: Record<string, string | null> = Object.fromEntries(patch.remove.map((r) => [r, null]))
        for (const e of patch.set) values[e.settingEnum] = iniText(e.value)
        const ini = editIni(files.ini, 'Settings', values)
        if (ini !== files.ini) next.ini = ini
    }
    if (files.gus !== null && gus) {
        let text = files.gus
        for (const [section, values] of Object.entries(gus)) text = editIni(text, section, values)
        if (text !== files.gus) next.gus = text
    }
    if (next.ini || next.gus) {
        try {
            await pushBackup(account.puuid, { kind: 'local', ini: files.ini, gus: files.gus })
            await invoke('gs_local_write', { dir: account.dir, ini: next.ini ?? null, gus: next.gus ?? null })
            res.local = 'applied'
        } catch (e) {
            if (!String(e).includes('game running')) throw e
            res.local = 'blocked'
        }
    }
    void qc.invalidateQueries({ queryKey: ['gs', 'view', account.puuid] })
    return res
}

export type CatalogItem = { settingEnum: string; category: Category; sample: Entry['value'] }

/** Every setting seen on any account on this PC, so defaults (which aren't stored) can be set too. */
export const useCatalog = () =>
    useQuery({
        queryKey: ['gs', 'catalog'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const map = new Map<string, CatalogItem>()
            for (const a of await invoke<GsAccount[]>('gs_accounts')) {
                const files = await invoke<LocalFiles>('gs_local_read', { dir: a.dir })
                const snap = await load<Snapshot>(`snap-${a.puuid}`)
                for (const e of [...(files.ini ? entries(parseIni(files.ini)) : []), ...(snap ? entries(snap.settings) : [])]) {
                    const category = categoryOf(e.settingEnum)
                    if (category && category !== 'crosshair' && !map.has(e.settingEnum)) map.set(e.settingEnum, { settingEnum: e.settingEnum, category, sample: e.value })
                }
            }
            return [...map.values()]
        }
    })

/** Restores a backup. Cloud backups need the account signed in. */
export const restoreBackup = async (qc: QueryClient, account: GsAccount, b: Backup) => {
    if (b.kind === 'cloud' && b.settings) {
        await invoke('gs_cloud_put', { puuid: account.puuid, settings: b.settings })
        await save(`snap-${account.puuid}`, { at: Date.now(), settings: b.settings } satisfies Snapshot)
    } else {
        await invoke('gs_local_write', { dir: account.dir, ini: b.ini ?? null, gus: b.gus ?? null })
    }
    void qc.invalidateQueries({ queryKey: ['gs', 'view', account.puuid] })
}

/** Deletes the account's Valorant config folder and everything the app keeps for it. */
export const deleteAccount = async (qc: QueryClient, account: GsAccount) => {
    await invoke('gs_delete_account', { dir: account.dir, puuid: account.puuid })
    const drop = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== account.puuid))
    await updateState(qc, (s) => ({ ...s, names: drop(s.names), nameMisses: drop(s.nameMisses), pending: drop(s.pending), applied: drop(s.applied), excluded: s.excluded.filter((x) => x !== account.puuid) }))
    qc.removeQueries({ queryKey: ['gs', 'view', account.puuid] })
    await qc.invalidateQueries({ queryKey: ['gs', 'accounts'] })
}

// ---- Import / export ----

const FORMAT = 'clutchboard.game-settings'

export const exportJson = (p: Preset) => JSON.stringify({ format: FORMAT, version: 1, name: p.name, createdAt: p.createdAt, source: p.source, categories: p.categories, data: p.data }, null, 2)

export const importJson = (text: string): Preset => {
    const j = JSON.parse(text) as Partial<Preset> & { format?: string }
    if (j.format !== FORMAT || !j.data || typeof j.data.blob !== 'object') throw new Error('not a ClutchBoard settings file')
    const categories = (j.categories ?? []).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c))
    return { id: crypto.randomUUID(), name: String(j.name ?? 'Imported'), createdAt: Date.now(), source: j.source, categories, data: j.data }
}

export const saveExport = (fileName: string, content: string) => invoke<string>('gs_export', { fileName, content })
