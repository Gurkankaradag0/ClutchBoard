// Keeps package.json and src-tauri/Cargo.toml versions in sync.
//
//   bun run set-version                   list current versions
//   bun run set-version 0.2.0             set both to 0.2.0
//   bun run set-version patch|minor|major bump from the highest current version
//
// The app version comes from package.json (tauri.conf.json -> "version": "../package.json").
// Only the version line is replaced, so formatting and line endings stay intact.

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// First match is the top-level field in both files.
const TARGETS = [
    { label: 'package.json', file: join(ROOT, 'package.json'), line: /^(\s*"version"\s*:\s*")([^"]+)(")/m },
    { label: 'Cargo.toml', file: join(ROOT, 'src-tauri', 'Cargo.toml'), line: /^(version\s*=\s*")([^"]+)(")/m }
]
const TAURI_CONF = join(ROOT, 'src-tauri', 'tauri.conf.json')

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/
const BUMPS = ['major', 'minor', 'patch'] as const
type Bump = (typeof BUMPS)[number]

const read = (t: (typeof TARGETS)[number]) => {
    const raw = readFileSync(t.file, 'utf8')
    const match = raw.match(t.line)
    if (!match?.[2]) throw new Error(`version field not found: ${t.file}`)
    return { ...t, raw, current: match[2] }
}

const rank = (version: string) => {
    const m = version.match(SEMVER)
    return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : -1
}

const bump = (version: string, kind: Bump) => {
    const m = version.match(SEMVER)
    if (!m) throw new Error(`invalid version: ${version}`)
    const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (kind === 'major') return `${major + 1}.0.0`
    if (kind === 'minor') return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
}

const main = () => {
    const arg = process.argv[2]
    const states = TARGETS.map(read)

    const tauriVersion = (JSON.parse(readFileSync(TAURI_CONF, 'utf8')) as { version?: string }).version
    if (tauriVersion !== '../package.json') console.warn(`tauri.conf.json "version" is "${tauriVersion}", expected "../package.json"\n`)

    if (!arg) {
        console.log('Current versions:')
        states.forEach((s) => console.log(`  ${s.label.padEnd(13)} ${s.current}`))
        const distinct = new Set(states.map((s) => s.current))
        if (distinct.size > 1) console.log(`\nVersions differ (${[...distinct].join(' / ')}). Run: bun run set-version <version>`)
        console.log('\nUsage: bun run set-version <version | patch | minor | major>')
        return
    }

    const highest = [...states].sort((a, b) => rank(b.current) - rank(a.current))[0]!.current
    const next = (BUMPS as readonly string[]).includes(arg) ? bump(highest, arg as Bump) : arg

    if (!SEMVER.test(next)) {
        console.error(`Invalid version "${next}", expected 1.2.3 (optional -beta.1 suffix).`)
        process.exit(1)
    }
    // The updater only installs higher versions.
    if (rank(next) < rank(highest)) console.warn(`${next} is lower than ${highest}; installed apps won't update to it.`)

    states.forEach((s) => {
        if (s.current === next) return console.log(`  ${s.label.padEnd(13)} ${s.current} (unchanged)`)
        writeFileSync(s.file, s.raw.replace(s.line, `$1${next}$3`))
        console.log(`  ${s.label.padEnd(13)} ${s.current} -> ${next}`)
    })

    console.log(`\nVersion ${next}. To publish: bun run release -- "notes"`)
}

main()
