import { useState } from 'react'
import { supabase } from './lib'
import Dashboard from './Dashboard'
import Products from './Products'
import Suppliers from './Suppliers'
import Calculator from './Calculator'
import Sales from './Sales'
import Finance from './Finance'

const NAV = [['dash', 'Panel'], ['products', 'Productos'], ['suppliers', 'Proveedores'], ['calc', 'Calculadora'], ['sales', 'Ventas'], ['finance', 'Finanzas']] as const
export default function Shell({ ws, uid }: { ws: { id: string; name: string }; uid: string }) {
  const [view, setView] = useState<string>('dash')
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 backdrop-blur bg-astro-black/80 border-b border-astro-border">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3">
          <img src="/logo.png" alt="ASTRO IMPORT" className="h-10" />
          <div className="leading-tight"><p className="font-semibold tracking-wide">ASTRO IMPORT</p><p className="text-xs text-astro-gray">{ws.name}</p></div>
          <button className="btn-ghost ml-auto" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {NAV.map(([k, l]) => <button key={k} onClick={() => setView(k)}
            className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${view === k ? 'border-astro-violet-500 text-white' : 'border-transparent text-astro-gray hover:text-white'}`}>{l}</button>)}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto p-4">
        {view === 'dash' && <Dashboard ws={ws} />}
        {view === 'products' && <Products ws={ws} uid={uid} />}
        {view === 'suppliers' && <Suppliers ws={ws} uid={uid} />}
        {view === 'calc' && <Calculator ws={ws} uid={uid} />}
        {view === 'sales' && <Sales ws={ws} uid={uid} />}
        {view === 'finance' && <Finance ws={ws} uid={uid} />}
      </main>
    </div>
  )
}
