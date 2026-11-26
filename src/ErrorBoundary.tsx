import { Component, type ReactNode } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="card border-red-500/50 text-sm space-y-2"><p className="font-medium text-red-300">Algo falló al mostrar esta sección.</p>
      <p className="text-astro-gray">{this.state.error.message}</p><button className="btn-ghost" onClick={() => this.setState({ error: null })}>Reintentar</button></div>
  }
}
