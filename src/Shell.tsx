import { useEffect, useState } from 'react'
import { supabase } from './lib'
import { Icon } from './icons'
import Dashboard from './Dashboard'
import Products from './Products'
import Suppliers from './Suppliers'
import Calculator from './Calculator'
import Sales from './Sales'
import Finance from './Finance'
import Messages from './Messages'
import Tasks from './Tasks'
import Reports from './Reports'
import Bell from './Bell'
import ErrorBoundary from './ErrorBoundary'

const NAV: [string, string, string][] = [['dash', 'Panel', 'dash'], ['products', 'Productos', 'box'], ['suppliers', 'Proveedores', 'truck'], ['calc', 'Calculadora', 'calc'],
  ['sales', 'Ventas', 'receipt'], ['finance', 'Finanzas', 'trend'], ['messages', 'Mensajes', 'chat'], ['tasks', 'Tareas', 'check'], ['reports', 'Reportes', 'file']]

export default function Shell({ ws, uid }: { ws: { id: string; name: string }; uid: string }) {
  const [view, setView] = useState('dash'), [online, setOnline] = useState(navigator.onLine)
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) } }, [])
  const logout = () => supabase.auth.signOut()
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen p-4 border-r border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="flex flex-col items-center text-center pb-4 mb-3 border-b border-white/10">
          <img src="/logo.png" alt="ASTRO IMPORT" className="h-20 drop-shadow-[0_0_22px_rgba(144,80,255,.6)]" />
          <p className="font-bold tracking-[.2em] mt-1">ASTRO IMPORT</p><p className="text-xs text-astro-gray">{ws.name}</p></div>
        <nav className="space-y-1 flex-1">{NAV.map(([k, l, i]) => <button key={k} onClick={() => setView(k)} className={`nav-item ${view === k ? 'active' : ''}`}><Icon n={i} className="w-[18px] h-[18px]" />{l}</button>)}</nav>
        <button className="nav-item" onClick={logout}><Icon n="out" className="w-[18px] h-[18px]" />Cerrar sesión</button>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 backdrop-blur-xl bg-black/50 border-b border-white/10">
          <div className="px-4 py-2 flex items-center gap-3">
            <img src="/logo.png" alt="" className="h-9 lg:hidden" />
            <div className="leading-tight"><p className="font-semibold">{NAV.find(n => n[0] === view)?.[1]}</p><p className="text-xs text-astro-gray lg:hidden">{ws.name}</p></div>
            <div className="ml-auto flex items-center gap-2"><Bell wsId={ws.id} uid={uid} go={setView} view={view} /><button className="btn-ghost lg:hidden" onClick={logout} aria-label="Cerrar sesión"><Icon n="out" className="w-4 h-4" /></button></div>
          </div>
          <nav className="lg:hidden px-3 pb-2 flex gap-1 overflow-x-auto">{NAV.map(([k, l, i]) => <button key={k} onClick={() => setView(k)} className={`nav-item !w-auto !px-3 !py-1.5 whitespace-nowrap ${view === k ? 'active' : ''}`}><Icon n={i} className="w-4 h-4" />{l}</button>)}</nav>
        </header>
        <main className="max-w-6xl mx-auto p-4 sm:p-6">
          {!online && <div className="card border-amber-500/50 text-amber-300 text-sm mb-3">Sin conexión a internet. Los cambios no se guardarán hasta que vuelva.</div>}
          <ErrorBoundary key={view}><div className="page">
            {view === 'dash' && <Dashboard ws={ws} />}{view === 'products' && <Products ws={ws} uid={uid} />}{view === 'suppliers' && <Suppliers ws={ws} uid={uid} />}
            {view === 'calc' && <Calculator ws={ws} uid={uid} />}{view === 'sales' && <Sales ws={ws} uid={uid} />}{view === 'finance' && <Finance ws={ws} uid={uid} />}
            {view === 'messages' && <Messages ws={ws} uid={uid} />}{view === 'tasks' && <Tasks ws={ws} uid={uid} />}{view === 'reports' && <Reports ws={ws} />}
          </div></ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
