// Rewrites arbitrary Tailwind values to the native scale when there's an exact match
// (`gap-[8px]` -> `gap-2`), like IntelliSense's quick fix but for the whole project.
// Values without an exact match are left alone. `--check` exits 1 if anything would change.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = 'src'

// Longer prefixes first (`px` before `p`).
const SPACING = ['gap-x', 'gap-y', 'gap', 'space-x', 'space-y', 'translate-x', 'translate-y', 'inset-x', 'inset-y', 'inset', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'p', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'm', 'top', 'right', 'bottom', 'left', 'h', 'w', 'size', 'min-w', 'min-h', 'max-w', 'max-h', 'basis']
const SPACING_RE = new RegExp(`(?<![\\w\\-\\[])(-?)(${SPACING.join('|')})-\\[(\\d+(?:\\.\\d+)?)px\\]`, 'g')

const RADIUS: Record<number, string> = { 2: 'rounded-xs', 4: 'rounded-sm', 6: 'rounded-md', 8: 'rounded-lg' }
const RADIUS_RE = /(?<![\w\-\[])rounded-\[(\d+(?:\.\d+)?)px\]/g

// `text-<size>` also sets line height, so only exact size/line-height pairs are converted.
const FONT: Record<string, string> = { '12/16': 'text-xs', '14/20': 'text-sm', '16/24': 'text-base', '18/28': 'text-lg', '20/28': 'text-xl', '24/32': 'text-2xl', '30/36': 'text-3xl' }
const FONT_RE = /(?<![\w\-\[])text-\[(\d+)px\]\/\[(\d+)px\]/g

const CLASS_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g
// Class strings passed to cn()/clsx().
const CN_RE = /(?<=[(,]\s?)'([^']*\b(?:flex|grid|absolute|relative|fixed|pointer-events|text-|bg-|rounded|gap-|p[xytblr]?-)[^']*)'/g

let count = 0

const convert = (classes: string): string => {
    let out = classes.replace(SPACING_RE, (all, sign: string, name: string, px: string) => {
        const step = Number(px) / 4
        // The scale has quarter steps; anything else has no exact match.
        if (step * 4 !== Math.trunc(step * 4)) return all
        count++
        return `${sign}${name}-${step}`
    })
    out = out.replace(RADIUS_RE, (all, px: string) => {
        const n = Number(px)
        if (!Number.isInteger(n) || !RADIUS[n]) return all
        count++
        return RADIUS[n]
    })
    out = out.replace(FONT_RE, (all, size: string, lh: string) => {
        const name = FONT[`${size}/${lh}`]
        if (!name) return all
        count++
        return name
    })
    return out
}

const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) return files(p)
        return p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : []
    })

const run = (check: boolean) => {
    const changed: { p: string; n: number }[] = []

    for (const p of files(ROOT)) {
        const src = readFileSync(p, 'utf8')
        const before = count

        let next = src.replace(CLASS_RE, (all, dq?: string, tpl?: string) => {
            const inner = dq ?? tpl ?? ''
            const out = convert(inner)
            if (out === inner) return all
            return dq !== undefined ? `className="${out}"` : `className={\`${out}\`}`
        })
        next = next.replace(CN_RE, (all, inner: string) => {
            const out = convert(inner)
            return out === inner ? all : `'${out}'`
        })

        if (next !== src) {
            if (!check) writeFileSync(p, next)
            changed.push({ p: relative(ROOT, p), n: count - before })
        }
    }

    for (const c of changed.sort((a, b) => b.n - a.n)) console.log(`  ${String(c.n).padEnd(4)} ${c.p}`)

    if (!changed.length) {
        console.log('  Tailwind classes are canonical ✓')
        return 0
    }
    console.log(`  ${changed.length} files · ${count} classes ${check ? 'can be converted' : 'converted'}`)
    return check ? 1 : 0
}

process.exit(run(process.argv.includes('--check')))
