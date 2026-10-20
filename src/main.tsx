import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/lib/migrate'
import '@/lib/context-menu'
import '@/i18n'
import '@/styles/globals.css'
import App from '@/App'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
)
