import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const host = process.env.TAURI_DEV_HOST

// Tauri expects a fixed port; keep Rust errors visible.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    clearScreen: false,
    // Loaded from disk, so the bundle size warning doesn't matter.
    build: { chunkSizeWarningLimit: 1500 },
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] }
    }
})
