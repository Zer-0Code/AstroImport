import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib'
import Auth from './Auth'
import Shell from './Shell'

type W = { id: string; name: string }
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [ws, setWs] = useState<W | null | undefined>(undefined)
  const [name, setName] = useState(''), [err, setErr] = useState(''), [loadErr, setLoadErr] = useState(''), [note, setNote] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  async function loadWs(uid: string) {
    setLoadErr('')
    await supabase.rpc('claim_invites')
    const { data, error } = await supabase.from('workspace_members').select('workspaces(id,name)').eq('user_id', uid).maybeSingle()
    if (error) { setLoadErr(error.message); return }
    setWs((data as any)?.workspaces ?? null)
  }
  useEffect(() => { if (session) loadWs(session.user.id); else setWs(undefined) }, [session?.user.id])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('create_workspace', { p_name: name })
    if (error) setErr(error.message); else loadWs(session!.user.id)
  }
  async function recheck() {
    setNote(''); await loadWs(session!.user.id); setNote('Aún no encontramos una invitación para este correo.')
  }

  if (session === undefined) return <div className="min-h-dvh grid place-items-center text-astro-gray">Cargando…</div>
  if (!session) return <Auth />
  if (loadErr) return (
    <div className="min-h-dvh grid place-items-center p-4"><div className="card max-w-sm space-y-3 text-center">
      <p className="font-medium text-red-300">No se pudo cargar tu negocio</p><p className="text-sm text-astro-gray">{loadErr}</p>
      <button className="btn w-full" onClick={() => loadWs(session.user.id)}>Reintentar</button><button className="btn-ghost w-full" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></div></div>)
  if (ws === undefined) return <div className="min-h-dvh grid place-items-center text-astro-gray">Cargando negocio…</div>
  if (ws === null) return (
    <div className="min-h-dvh grid place-items-center p-4">
      <div className="card w-full max-w-md space-y-4 page">
        <img src="/logo.png" alt="" className="h-20 mx-auto drop-shadow-[0_0_24px_rgba(144,80,255,.6)]" />
        <section className="space-y-2"><h1 className="text-lg font-semibold">Soy el segundo propietario</h1>
          <p className="text-sm text-astro-gray">Pídele a tu socio que te invite desde su Panel con este correo: <b className="text-white">{session.user.email}</b>. Después pulsa el botón.</p>
          <button className="btn w-full" onClick={recheck}>Ya me invitaron: entrar</button>{note && <p className="text-xs text-amber-400">{note}</p>}</section>
        <form onSubmit={create} className="space-y-2 border-t border-white/10 pt-4"><h2 className="text-lg font-semibold">Soy el primer propietario</h2>
          <p className="text-sm text-astro-gray">Crea el negocio. Solo lo hace una persona; la otra entra por invitación.</p>
          <input className="input" placeholder="Nombre del negocio" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
          {err && <p className="text-sm text-red-400">{err}</p>}<button className="btn-ghost w-full">Crear negocio</button></form>
        <button type="button" className="text-xs text-astro-gray w-full" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </div></div>)
  return <Shell ws={ws} uid={session.user.id} />
}
