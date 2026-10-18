// Valorant crosshair profiles (SavedCrosshairProfileData) and share codes ("0;P;c;5;h;0;...").
// A code lists only values that differ from the defaults below, as `key;value` pairs grouped
// under section markers: 0 = general, P = primary, A = aim down sights, S = sniper scope.

export type Rgba = { r: number; g: number; b: number; a: number }
export type Lines = {
    lineThickness: number
    lineLength: number
    lineLengthVertical: number
    bAllowVertScaling: boolean
    lineOffset: number
    bShowMovementError: boolean
    bShowShootingError: boolean
    bShowMinError: boolean
    opacity: number
    bShowLines: boolean
    firingErrorScale: number
    movementErrorScale: number
}
export type Layer = {
    color: Rgba
    colorCustom: Rgba
    bUseCustomColor: boolean
    bHasOutline: boolean
    outlineThickness: number
    outlineColor: Rgba
    outlineOpacity: number
    centerDotSize: number
    centerDotOpacity: number
    bDisplayCenterDot: boolean
    bFadeCrosshairWithFiringError: boolean
    bShowSpectatedPlayerCrosshair: boolean
    bHideCrosshair: boolean
    bFixMinErrorAcrossWeapons: boolean
    innerLines: Lines
    outerLines: Lines
}
export type Sniper = { centerDotColor: Rgba; centerDotColorCustom: Rgba; bUseCustomCenterDotColor: boolean; centerDotSize: number; centerDotOpacity: number; bDisplayCenterDot: boolean }
export type Profile = {
    primary: Layer
    aDS: Layer
    focusMode?: Layer
    sniper: Sniper
    bUsePrimaryCrosshairForADS: boolean
    bUsePrimaryCrosshairForFocusMode?: boolean
    bUseCustomCrosshairOnAllPrimary: boolean
    bUseAdvancedOptions: boolean
    bScaleToResolution?: boolean
    profileName: string
}
export type ProfileData = { currentProfile: number; profiles: Profile[] }

// Index 8 is "custom" (hex in the code).
const COLORS: [number, number, number][] = [
    [255, 255, 255],
    [0, 255, 0],
    [127, 255, 0],
    [223, 255, 0],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 0, 0]
]
const CUSTOM = 8

const rgb = (i: number): Rgba => {
    const [r, g, b] = COLORS[i] ?? COLORS[0]!
    return { r, g, b, a: 255 }
}

const lines = (length: number, offset: number, opacity: number, movement: boolean): Lines => ({
    lineThickness: 2,
    lineLength: length,
    lineLengthVertical: length,
    bAllowVertScaling: false,
    lineOffset: offset,
    bShowMovementError: movement,
    bShowShootingError: true,
    bShowMinError: true,
    opacity,
    bShowLines: true,
    firingErrorScale: 1,
    movementErrorScale: 1
})

const layer = (): Layer => ({
    color: rgb(0),
    colorCustom: rgb(0),
    bUseCustomColor: false,
    bHasOutline: true,
    outlineThickness: 1,
    outlineColor: { r: 0, g: 0, b: 0, a: 255 },
    outlineOpacity: 0.5,
    centerDotSize: 2,
    centerDotOpacity: 1,
    bDisplayCenterDot: false,
    bFadeCrosshairWithFiringError: true,
    bShowSpectatedPlayerCrosshair: true,
    bHideCrosshair: false,
    bFixMinErrorAcrossWeapons: false,
    innerLines: lines(6, 3, 0.8, false),
    outerLines: lines(2, 10, 0.35, true)
})

export const defaultProfile = (profileName: string): Profile => ({
    primary: layer(),
    aDS: layer(),
    sniper: { centerDotColor: rgb(7), centerDotColorCustom: rgb(0), bUseCustomCenterDotColor: false, centerDotSize: 1, centerDotOpacity: 0.75, bDisplayCenterDot: true },
    bUsePrimaryCrosshairForADS: true,
    bUseCustomCrosshairOnAllPrimary: false,
    bUseAdvancedOptions: false,
    profileName
})

type Field<T> = [key: string, prop: keyof T, kind: 'bool' | 'num', def: number]

const GENERAL: Field<Profile>[] = [
    ['p', 'bUsePrimaryCrosshairForADS', 'bool', 1],
    ['c', 'bUseCustomCrosshairOnAllPrimary', 'bool', 0],
    ['s', 'bUseAdvancedOptions', 'bool', 0]
]
// Code order follows what the game exports; color (c/u/b) is handled separately.
const LAYER: Field<Layer>[] = [
    ['h', 'bHasOutline', 'bool', 1],
    ['t', 'outlineThickness', 'num', 1],
    ['o', 'outlineOpacity', 'num', 0.5],
    ['d', 'bDisplayCenterDot', 'bool', 0],
    ['z', 'centerDotSize', 'num', 2],
    ['a', 'centerDotOpacity', 'num', 1],
    ['f', 'bFadeCrosshairWithFiringError', 'bool', 1],
    ['s', 'bShowSpectatedPlayerCrosshair', 'bool', 1],
    ['m', 'bFixMinErrorAcrossWeapons', 'bool', 0]
]
const PRIMARY_ONLY = new Set(['f', 's'])
const LINES = (inner: boolean): Field<Lines>[] => [
    ['b', 'bShowLines', 'bool', 1],
    ['t', 'lineThickness', 'num', 2],
    ['l', 'lineLength', 'num', inner ? 6 : 2],
    ['v', 'lineLengthVertical', 'num', inner ? 6 : 2],
    ['g', 'bAllowVertScaling', 'bool', 0],
    ['o', 'lineOffset', 'num', inner ? 3 : 10],
    ['a', 'opacity', 'num', inner ? 0.8 : 0.35],
    ['m', 'bShowMovementError', 'bool', inner ? 0 : 1],
    ['s', 'movementErrorScale', 'num', 1],
    ['f', 'bShowShootingError', 'bool', 1],
    ['e', 'firingErrorScale', 'num', 1]
]
const SNIPER: Field<Sniper>[] = [
    ['d', 'bDisplayCenterDot', 'bool', 1],
    ['s', 'centerDotSize', 'num', 1],
    ['o', 'centerDotOpacity', 'num', 0.75]
]

// Stored values are floats (0.800000011920929); codes use up to 3 decimals.
const num = (n: number) => String(Math.round(n * 1000) / 1000)
const asNum = (v: unknown) => (typeof v === 'boolean' ? Number(v) : Number(v))

const hex = (c: Rgba) =>
    [c.r, c.g, c.b, c.a]
        .map((n) =>
            Math.max(0, Math.min(255, Math.round(n)))
                .toString(16)
                .padStart(2, '0')
        )
        .join('')
        .toUpperCase()
const parseHex = (h: string): Rgba | null => {
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 255 }
}
const colorIndex = (c: Rgba) => COLORS.findIndex(([r, g, b]) => r === c.r && g === c.g && b === c.b)

const encodeFields = <T>(out: string[], obj: T, fields: Field<T>[], prefix = '') => {
    for (const [key, prop, , def] of fields) {
        const v = num(asNum(obj[prop]))
        if (v !== num(def)) out.push(prefix + key, v)
    }
}

const encodeColor = (out: string[], custom: boolean, preset: Rgba, color: Rgba, def: number, hexKey: string) => {
    const i = custom ? -1 : colorIndex(preset)
    if (i === -1) out.push('c', String(CUSTOM), hexKey, hex(color), 'b', '1')
    else if (i !== def) out.push('c', String(i))
}

const encodeLayer = (l: Layer, primary: boolean) => {
    const out: string[] = []
    encodeColor(out, l.bUseCustomColor, l.color, l.colorCustom, 0, 'u')
    encodeFields(
        out,
        l,
        LAYER.filter(([k]) => primary || !PRIMARY_ONLY.has(k))
    )
    encodeFields(out, l.innerLines, LINES(true), '0')
    encodeFields(out, l.outerLines, LINES(false), '1')
    return out
}

/** Share code for a profile, as accepted by the game's "Import profile code". */
export const encodeCrosshair = (p: Profile) => {
    const out = ['0']
    encodeFields(out, p, GENERAL)
    out.push('P', ...encodeLayer(p.primary, true))
    if (!p.bUsePrimaryCrosshairForADS) {
        const ads = encodeLayer(p.aDS, false)
        if (ads.length) out.push('A', ...ads)
    }
    const s: string[] = []
    encodeColor(s, p.sniper.bUseCustomCenterDotColor, p.sniper.centerDotColor, p.sniper.centerDotColorCustom, 7, 't')
    encodeFields(s, p.sniper, SNIPER)
    if (s.length) out.push('S', ...s)
    return out.join(';')
}

const applyField = <T>(obj: T, fields: Field<T>[], key: string, value: string) => {
    const f = fields.find(([k]) => k === key)
    if (!f) return false
    const n = Number(value)
    if (Number.isNaN(n)) return false
    ;(obj as Record<string, unknown>)[f[1] as string] = f[2] === 'bool' ? n !== 0 : n
    return true
}

/** Parses a share code. Returns null if it isn't one. Unknown keys are ignored. */
export const decodeCrosshair = (code: string, profileName: string): Profile | null => {
    const parts = code.trim().split(';')
    if (parts[0] !== '0' || parts.length < 2) return null
    const p = defaultProfile(profileName)
    let section = '0'
    // Color keys can come in any order, so they're resolved per section at the end.
    const colors: Record<string, { c?: number; hex?: Rgba; custom?: boolean }> = {}
    let i = 1
    while (i < parts.length) {
        const key = parts[i]!
        if (key === 'P' || key === 'A' || key === 'S') {
            section = key
            i++
            continue
        }
        const value = parts[i + 1]
        if (value === undefined) break
        i += 2
        const col = (colors[section] ??= {})
        if (section === '0') applyField(p, GENERAL, key, value)
        else if (section === 'S') {
            if (key === 'c') col.c = Number(value)
            else if (key === 't') col.hex = parseHex(value) ?? undefined
            else if (key === 'b') col.custom = value === '1'
            else applyField(p.sniper, SNIPER, key, value)
        } else {
            const l = section === 'P' ? p.primary : p.aDS
            if (key === 'c') col.c = Number(value)
            else if (key === 'u') col.hex = parseHex(value) ?? undefined
            else if (key === 'b') col.custom = value === '1'
            else if (key.length === 2 && (key[0] === '0' || key[0] === '1')) applyField(key[0] === '0' ? l.innerLines : l.outerLines, LINES(key[0] === '0'), key[1]!, value)
            else applyField(l, LAYER, key, value)
        }
    }
    for (const [s, col] of Object.entries(colors)) {
        const custom = col.custom === true || col.c === CUSTOM
        if (s === 'S') {
            p.sniper.bUseCustomCenterDotColor = custom
            if (custom && col.hex) p.sniper.centerDotColorCustom = col.hex
            else if (col.c !== undefined && col.c < CUSTOM) p.sniper.centerDotColor = rgb(col.c)
        } else if (s === 'P' || s === 'A') {
            const l = s === 'P' ? p.primary : p.aDS
            l.bUseCustomColor = custom
            if (custom && col.hex) l.colorCustom = col.hex
            else if (col.c !== undefined && col.c < CUSTOM) l.color = rgb(col.c)
        }
    }
    if (p.bUsePrimaryCrosshairForADS) p.aDS = structuredClone(p.primary)
    return p
}

// Outline color isn't part of the code (the game's UI keeps it black), so it's compared separately.
const glow = (l: Layer) => (l.bHasOutline ? hex(l.outlineColor) : '')
export const sameCrosshair = (a: Profile, b: Profile) => encodeCrosshair(a) === encodeCrosshair(b) && glow(a.primary) === glow(b.primary) && glow(a.aDS) === glow(b.aDS)

/** The game's color presets, in code order. */
export const PRESET_COLORS = COLORS.map((_, i) => rgb(i))
export const toCss = (c: Rgba) => `#${hex(c).slice(0, 6).toLowerCase()}`
export const fromCss = (v: string, a = 255): Rgba | null => {
    const c = parseHex(v.replace('#', ''))
    return c && { ...c, a: v.replace('#', '').length === 8 ? c.a : a }
}

export const layerColor = (l: Layer) => (l.bUseCustomColor ? l.colorCustom : l.color)
