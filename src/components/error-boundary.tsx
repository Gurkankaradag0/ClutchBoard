import { Component, type ReactNode } from 'react'
import i18n from '@/i18n'

type State = { error: Error | null }

// Catches render errors per page (Shell resets it with key={pathname}). Error boundaries still need a class.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    render() {
        if (!this.state.error) return this.props.children
        return (
            <div role="alert" className="m-8 rounded-md border border-loss/30 bg-loss/8 p-4 text-sm">
                <p className="font-semibold">{i18n.t('errors.unknown')}</p>
                <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{this.state.error.message}</pre>
            </div>
        )
    }
}
