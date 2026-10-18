import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { HashRouter, Route, Routes } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Shell } from '@/components/layout/shell'
import SearchPage from '@/pages/search'
import ProfileLayout from '@/pages/profile/layout'
import OverviewPage from '@/pages/profile/overview'
import MatchesPage from '@/pages/profile/matches'
import PlayersPage from '@/pages/profile/players'
import PlayerWithPage from '@/pages/profile/player-with'
import MatchPage from '@/pages/match'
import SettingsPage from '@/pages/settings'
import MePage from '@/pages/me'
import LivePage from '@/pages/live'
import GameSettingsPage from '@/pages/game-settings'
import { GameSettingsWatcher } from '@/components/game-settings/watcher'
import { indexMatchesFrom } from '@/stores/players'

// TanStack v5 only listens to visibilitychange, which Alt+Tab doesn't fire on desktop.
focusManager.setEventListener((handleFocus) => {
    const onFocus = () => handleFocus(true)
    const onBlur = () => handleFocus(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
    }
})
// Feed players from opened matches into autocomplete.
indexMatchesFrom(queryClient)

const App = () => (
    <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
            <HashRouter>
                <Routes>
                    <Route element={<Shell />}>
                        <Route index element={<SearchPage />} />
                        <Route path="p/:name/:tag" element={<ProfileLayout />}>
                            <Route index element={<OverviewPage />} />
                            <Route path="matches" element={<MatchesPage />} />
                            <Route path="players" element={<PlayersPage />} />
                            <Route path="players/:mate" element={<PlayerWithPage />} />
                        </Route>
                        <Route path="match/:region/:id" element={<MatchPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="me" element={<MePage />} />
                        <Route path="live" element={<LivePage />} />
                        <Route path="game-settings" element={<GameSettingsPage />} />
                    </Route>
                </Routes>
            </HashRouter>
            <Toaster position="bottom-right" />
            <GameSettingsWatcher />
        </TooltipProvider>
    </QueryClientProvider>
)

export default App
