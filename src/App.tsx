import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib'
import Auth from './Auth'
import Shell from './Shell'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [ws, setWs] = useState<{ id: string; name: string } | null | undefined>(undefined)
  const [name, setName] = useState(''), [err, setErr] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  async function loadWs() {
    await supabase.rpc('claim_invites')
    const { data } = await supabase.from('workspace_members').select('workspaces(id,name)').maybeSingle()
    setWs((data as any)?.workspaces ?? null)
  }
  useEffect(() => { if (session) loadWs(); else setWs(undefined) }, [session?.user.id])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('create_workspace', { p_name: name })
    if (error) setErr(error.message); else loadWs()
  }

  if (session === undefined) return <div className="min-h-screen grid place-items-center text-astro-gray">Cargando…</div>
  if (!session) return <Auth />
  if (ws === undefined) return <div className="min-h-screen grid place-items-center text-astro-gray">Cargando negocio…</div>
  if (ws === null) return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={create} className="card w-full max-w-sm space-y-3">
        <img src="/logo.png" alt="" className="h-20 mx-auto" />
        <h1 className="text-lg font-semibold text-center">Crea tu negocio</h1>
        <p className="text-sm text-astro-gray text-center">Si tu socio ya te invitó con este correo, cierra sesión y vuelve a entrar con el correo confirmado.</p>
        <input className="input" placeholder="Nombre del negocio" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button className="btn w-full">Crear</button>
        <button type="button" className="btn-ghost w-full" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </form>
    </div>
  )
  return <Shell ws={ws} uid={session.user.id} />
}
