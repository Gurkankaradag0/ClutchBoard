// Moves localStorage keys from the old app name. Imported before any store.
// ponytail: drop once old installs have updated.
try {
    for (const k of ['lang', 'seen', 'recent']) {
        const old = localStorage.getItem(`valo-tracker:${k}`)
        if (old !== null && localStorage.getItem(`clutchboard:${k}`) === null) localStorage.setItem(`clutchboard:${k}`, old)
        localStorage.removeItem(`valo-tracker:${k}`)
    }
} catch {
    // storage unavailable
}
