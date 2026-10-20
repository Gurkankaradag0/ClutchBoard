// Release builds hide WebView2's browser menu (Back, Reload, Save as…). Text fields keep
// theirs for cut/copy/paste; dev builds keep everything for Inspect.
if (import.meta.env.PROD) {
    document.addEventListener('contextmenu', (e) => {
        const el = e.target as HTMLElement | null
        if (!el?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault()
    })
}
