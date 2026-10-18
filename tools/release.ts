// Signed release build: `bun run release [-- "notes"]`
// Builds the NSIS installer and writes release/{installer, latest.json} for a GitHub release.
// Signing key: ~/.tauri/clutchboard.key or TAURI_SIGNING_PRIVATE_KEY.
// Repo comes from package.json "repository"; latest.json points at the tagged download.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

const KEY_PATH = join(homedir(), '.tauri', 'clutchboard.key')

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; repository?: string | { url?: string } }
const version = pkg.version
const notes = process.argv[2] ?? `v${version}`

const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '')
const repo = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1]
if (!repo || repo.startsWith('OWNER/')) {
    console.error('package.json "repository" must be a GitHub URL, e.g. "https://github.com/user/repo"')
    process.exit(1)
}

// The updater endpoint baked into the app must match this repo.
const endpoint = `https://github.com/${repo}/releases/latest/download/latest.json`
const conf = JSON.parse(readFileSync(join('src-tauri', 'tauri.conf.json'), 'utf8')) as { plugins?: { updater?: { endpoints?: string[] } } }
if (!conf.plugins?.updater?.endpoints?.includes(endpoint)) {
    console.error(`tauri.conf.json plugins.updater.endpoints must include:\n  ${endpoint}`)
    process.exit(1)
}

const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? (existsSync(KEY_PATH) ? readFileSync(KEY_PATH, 'utf8') : '')
if (!key) {
    console.error(`No signing key: ${KEY_PATH} missing and TAURI_SIGNING_PRIVATE_KEY is empty.`)
    process.exit(1)
}

console.log(`Building v${version}...`)
const build = Bun.spawnSync(['bun', 'tauri', 'build'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' }
})
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

const nsis = join('src-tauri', 'target', 'release', 'bundle', 'nsis')
const setup = readdirSync(nsis).find((f) => f.includes(`_${version}_`) && f.endsWith('-setup.exe'))
if (!setup || !existsSync(join(nsis, `${setup}.sig`))) {
    console.error(`No v${version} installer or .sig in ${nsis}`)
    process.exit(1)
}

// No spaces in the download URL.
const fileName = setup.replace(/\s+/g, '')
mkdirSync('release', { recursive: true })
copyFileSync(join(nsis, setup), join('release', fileName))

const tag = `v${version}`
const latest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': { signature: readFileSync(join(nsis, `${setup}.sig`), 'utf8').trim(), url: `https://github.com/${repo}/releases/download/${tag}/${fileName}` } }
}
writeFileSync(join('release', 'latest.json'), JSON.stringify(latest, null, 4) + '\n')

// One-click installer for downloads, with the NSIS installer embedded (setup/src/main.rs).
// The NSIS installer stays the update package.
console.log('Building the setup app...')
const ui = await Bun.build({ entrypoints: [join('setup', 'ui', 'main.ts')], minify: true })
if (!ui.success) {
    console.error(ui.logs.join('\n'))
    process.exit(1)
}
writeFileSync(join('setup', 'ui', 'main.js'), await ui.outputs[0]!.text())
copyFileSync(join('docs', 'brand', 'wordmark-dark.svg'), join('setup', 'ui', 'wordmark.svg'))
const setupBuild = Bun.spawnSync(['cargo', 'build', '--release', '--manifest-path', join('setup', 'Cargo.toml')], {
    stdio: ['inherit', 'inherit', 'inherit'],
    // Same target dir as the app, so shared dependencies aren't compiled twice.
    env: { ...process.env, CB_INSTALLER: resolve(nsis, setup), CARGO_TARGET_DIR: resolve('src-tauri', 'target') }
})
if (setupBuild.exitCode !== 0) process.exit(setupBuild.exitCode ?? 1)
// Fixed name, so README can link to releases/latest/download/ClutchBoard-Setup.exe.
const setupName = 'ClutchBoard-Setup.exe'
copyFileSync(join('src-tauri', 'target', 'release', 'clutchboard-setup.exe'), join('release', setupName))

console.log(`
release/${setupName}   (download)
release/${fileName}   (updates)
release/latest.json
New release: https://github.com/${repo}/releases/new
  Tag: ${tag}   Title: ClutchBoard ${tag}
  Attach all three files and mark it as the latest release.`)
