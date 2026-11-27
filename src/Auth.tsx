import { useState } from 'react'
import { supabase } from './lib'

export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [pass, setPass] = useState('')
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password: pass })
      : await supabase.auth.signUp({ email, password: pass, options: { data: { full_name: name }, emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) setMsg(error.message)
    else if (mode === 'up' && !data.session) setMsg('Te enviamos un correo de confirmación. Ábrelo y vuelve a iniciar sesión.')
  }
  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <img src="/logo.png" alt="ASTRO IMPORT" className="h-24 mx-auto drop-shadow-[0_0_28px_rgba(144,80,255,.65)]" />
        <h1 className="text-center text-xl font-semibold tracking-wide">ASTRO IMPORT</h1>
        {mode === 'up' && <input className="input" placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} required />}
        <input className="input" type="email" placeholder="Correo" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Contraseña (mín. 8)" minLength={8} value={pass} onChange={e => setPass(e.target.value)} required />
        {msg && <p className="text-sm text-astro-violet-300">{msg}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? '...' : mode === 'in' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
        <button type="button" className="text-sm text-astro-gray w-full" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg('') }}>
          {mode === 'in' ? '¿Primera vez? Crear cuenta' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  )
}
