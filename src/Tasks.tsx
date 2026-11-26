import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, chan, iso } from './lib'
import { Modal, Field } from './ui'

type T = { id: string; title: string; description: string | null; assignee_id: string | null; due_date: string | null; priority: string; status: string; completed_at: string | null }
type R = { id: string; task_id: string | null; user_id: string | null; title: string; remind_at: string; done_at: string | null }
type L = { id: number; action: string; changes: any; created_at: string; actor_id: string | null }
const PR: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const ST: Record<string, string> = { pending: 'Pendiente', in_progress: 'En progreso', completed: 'Completada' }
const PCOL: Record<string, string> = { low: 'text-astro-gray', normal: 'text-white', high: 'text-amber-400', urgent: 'text-red-400' }
const PORD: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const FL: Record<string, string> = { title: 'título', description: 'descripción', assignee_id: 'responsable', due_date: 'fecha límite', priority: 'prioridad', status: 'estado' }
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16)
const empty = (uid: string) => ({ id: '', title: '', description: '', assignee: uid, due: '', priority: 'normal', status: 'pending', remind: '' })

export default function Tasks({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [tasks, setTasks] = useState<T[]>([]), [rems, setRems] = useState<R[]>([]), [mem, setMem] = useState<{ user_id: string; profiles: { full_name: string | null; email: string | null } | null }[]>([])
  const [q, setQ] = useState(''), [st, setSt] = useState('open'), [asg, setAsg] = useState(''), [pr, setPr] = useState('')
  const [f, setF] = useState<ReturnType<typeof empty> | null>(null), [hist, setHist] = useState<{ t: T; rows: L[] } | null>(null)
  const [rf, setRf] = useState<{ title: string; at: string } | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [, tick] = useState(0)

  const load = useCallback(async () => {
    const [t, r, m] = await Promise.all([supabase.from('tasks').select('*').eq('workspace_id', ws.id),
      supabase.from('reminders').select('*').eq('workspace_id', ws.id).is('done_at', null).order('remind_at'),
      supabase.from('workspace_members').select('user_id,profiles(full_name,email)').eq('workspace_id', ws.id)])
    const bad = t.error || r.error || m.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); setLoading(false); return }
    setTasks(t.data as T[]); setRems(r.data as R[]); setMem(m.data as any); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = chan('tasks-' + ws.id)
    for (const t of ['tasks', 'reminders']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); const i = window.setInterval(() => tick(x => x + 1), 60000)
    return () => { supabase.removeChannel(ch); clearInterval(i) }
  }, [ws.id, load])

  const who = (id: string | null) => { const m = mem.find(x => x.user_id === id); return m?.profiles?.full_name || m?.profiles?.email || 'Sin asignar' }
  const today = iso(new Date())
  const list = useMemo(() => tasks.filter(t => (st === 'open' ? t.status !== 'completed' : !st || t.status === st) && (!asg || t.assignee_id === asg) && (!pr || t.priority === pr) &&
    (!q.trim() || `${t.title} ${t.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (+(a.status === 'completed') - +(b.status === 'completed')) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || PORD[a.priority] - PORD[b.priority]), [tasks, st, asg, pr, q])
  const dueRems = rems.filter(r => r.user_id === uid && new Date(r.remind_at) <= new Date())
  const taskRems = (id: string) => rems.filter(r => r.task_id === id)

  function edit(t?: T) {
    setErr(''); setF(t ? { id: t.id, title: t.title, description: t.description ?? '', assignee: t.assignee_id ?? '', due: t.due_date ?? '', priority: t.priority, status: t.status, remind: '' } : empty(uid))
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f || busy) return
    if (!f.title.trim()) return setErr('El título es obligatorio.')
    setBusy(true); setErr('')
    const body = { title: f.title.trim(), description: f.description || null, assignee_id: f.assignee || null, due_date: f.due || null, priority: f.priority, status: f.status }
    const r = f.id ? await supabase.from('tasks').update(body).eq('id', f.id).select('id').single() : await supabase.from('tasks').insert({ ...body, workspace_id: ws.id, created_by: uid }).select('id').single()
    if (r.error) { setBusy(false); return setErr(r.error.message) }
    if (f.remind) {
      const { error } = await supabase.from('reminders').insert({ workspace_id: ws.id, task_id: r.data.id, user_id: f.assignee || uid, title: f.title.trim(), remind_at: new Date(f.remind).toISOString(), created_by: uid })
      if (error) { setBusy(false); return setErr('La tarea se guardó, pero no el recordatorio: ' + error.message) }
    }
    setBusy(false); setF(null); load()
  }
  async function setStatus(t: T, status: string) { const { error } = await supabase.from('tasks').update({ status }).eq('id', t.id); if (error) setErr(error.message); else load() }
  async function del(t: T) { if (window.confirm(`¿Eliminar la tarea "${t.title}"?`)) { const { error } = await supabase.from('tasks').delete().eq('id', t.id); if (error) setErr(error.message); else load() } }
  async function history(t: T) {
    const { data, error } = await supabase.from('audit_logs').select('id,action,changes,created_at,actor_id').eq('workspace_id', ws.id).eq('table_name', 'tasks').eq('record_id', t.id).order('created_at', { ascending: false })
    if (error) setErr(error.message); else setHist({ t, rows: data as L[] })
  }
  async function doneRem(r: R) { const { error } = await supabase.from('reminders').update({ done_at: new Date().toISOString() }).eq('id', r.id); if (error) setErr(error.message); else load() }
  async function delRem(r: R) { const { error } = await supabase.from('reminders').delete().eq('id', r.id); if (error) setErr(error.message); else load() }
  async function addRem(e: React.FormEvent) {
    e.preventDefault(); if (!rf || !rf.title.trim() || !rf.at) return setErr('Indica texto y fecha del recordatorio.')
    const { error } = await supabase.from('reminders').insert({ workspace_id: ws.id, user_id: uid, title: rf.title.trim(), remind_at: new Date(rf.at).toISOString(), created_by: uid })
    if (error) setErr(error.message); else { setRf(null); load() }
  }
  const val = (k: string, v: any) => k === 'assignee_id' ? who(v) : k === 'priority' ? PR[v] ?? v : k === 'status' ? ST[v] ?? v : v ?? '—'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Tareas y recordatorios</h2>
        <button className="btn-ghost" onClick={() => { setErr(''); setRf({ title: '', at: local(new Date(Date.now() + 36e5)) }) }}>Nuevo recordatorio</button><button className="btn" onClick={() => edit()}>Nueva tarea</button></div>
      {err && !f && !rf && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      {dueRems.length > 0 && <div className="card border-astro-violet-500/60 space-y-1"><p className="text-sm font-medium">🔔 Recordatorios para ti</p>
        {dueRems.map(r => <div key={r.id} className="flex items-center gap-2 text-sm"><span className="mr-auto">{r.title} <span className="text-xs text-astro-gray">({new Date(r.remind_at).toLocaleString('es-PE')})</span></span><button className="text-astro-violet-300" onClick={() => doneRem(r)}>Hecho</button></div>)}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input className="input col-span-2 md:col-span-1" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" value={st} onChange={e => setSt(e.target.value)}><option value="open">Abiertas</option><option value="">Todas</option>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={asg} onChange={e => setAsg(e.target.value)}><option value="">Todos los responsables</option>{mem.map(m => <option key={m.user_id} value={m.user_id}>{who(m.user_id)}</option>)}</select>
        <select className="input" value={pr} onChange={e => setPr(e.target.value)}><option value="">Toda prioridad</option>{Object.entries(PR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div className="space-y-2">{loading ? <p className="text-astro-gray">Cargando…</p> : list.length === 0 ? <div className="card text-sm text-astro-gray">{tasks.length ? 'Sin tareas con esos filtros.' : 'Aún no hay tareas. Ejemplos: revisar precios de proveedores, comprar stock, renovar suscripciones.'}</div> :
        list.map(t => { const late = t.status !== 'completed' && t.due_date && t.due_date < today; return (
          <div key={t.id} className="card !py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex-1 min-w-[12rem]"><p className={`font-medium ${t.status === 'completed' ? 'line-through text-astro-gray' : ''}`}>{t.title}</p>
              {t.description && <p className="text-xs text-astro-gray">{t.description}</p>}
              <p className="text-xs text-astro-gray">{who(t.assignee_id)} · <span className={late ? 'text-red-400' : ''}>{t.due_date ? `vence ${t.due_date}${late ? ' (vencida)' : ''}` : 'sin fecha límite'}</span>
                {taskRems(t.id).map(r => <span key={r.id} className="ml-2">🔔 {new Date(r.remind_at).toLocaleString('es-PE')} <button className="text-red-400" onClick={() => delRem(r)} aria-label="Quitar recordatorio">×</button></span>)}</p></div>
            <span className={`text-sm ${PCOL[t.priority]}`}>{PR[t.priority]}</span>
            <select className="bg-transparent text-sm" value={t.status} onChange={e => setStatus(t, e.target.value)}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k} className="bg-black">{l}</option>)}</select>
            <div className="text-sm space-x-2 text-astro-violet-300"><button onClick={() => edit(t)}>Editar</button><button onClick={() => history(t)}>Historial</button><button className="text-red-400" onClick={() => del(t)}>Eliminar</button></div>
          </div>) })}</div>
      {rems.filter(r => !r.task_id).length > 0 && <section className="card"><h3 className="font-medium mb-1 text-sm">Recordatorios sueltos pendientes</h3>
        {rems.filter(r => !r.task_id).map(r => <div key={r.id} className="flex gap-2 text-sm py-0.5"><span className="mr-auto">{r.title} · {new Date(r.remind_at).toLocaleString('es-PE')} <span className="text-astro-gray">({who(r.user_id)})</span></span>
          <button className="text-astro-violet-300" onClick={() => doneRem(r)}>Hecho</button><button className="text-red-400" onClick={() => delRem(r)}>Quitar</button></div>)}</section>}

      {f && <Modal title={f.id ? 'Editar tarea' : 'Nueva tarea'} onClose={() => setF(null)}>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <Field label="Título *" className="sm:col-span-2"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="Descripción" className="sm:col-span-2"><textarea className="input" rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Responsable"><select className="input" value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })}><option value="">Sin asignar</option>{mem.map(m => <option key={m.user_id} value={m.user_id}>{who(m.user_id)}</option>)}</select></Field>
          <Field label="Fecha límite"><input className="input" type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="Prioridad"><select className="input" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>{Object.entries(PR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Estado"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Añadir recordatorio (opcional)" className="sm:col-span-2"><input className="input" type="datetime-local" value={f.remind} onChange={e => setF({ ...f, remind: e.target.value })} /></Field>
          {err && <p className="sm:col-span-2 text-sm text-red-400">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setF(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
        </form></Modal>}
      {rf && <Modal title="Nuevo recordatorio" onClose={() => setRf(null)}>
        <form onSubmit={addRem} className="space-y-3"><Field label="Qué recordar"><input className="input" value={rf.title} onChange={e => setRf({ ...rf, title: e.target.value })} required /></Field>
          <Field label="Cuándo"><input className="input" type="datetime-local" value={rf.at} onChange={e => setRf({ ...rf, at: e.target.value })} required /></Field>
          {err && <p className="text-sm text-red-400">{err}</p>}<div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setRf(null)}>Cancelar</button><button className="btn">Guardar</button></div></form></Modal>}
      {hist && <Modal title={`Historial · ${hist.t.title}`} onClose={() => setHist(null)}>
        {hist.rows.length === 0 ? <p className="text-sm text-astro-gray">Sin registros.</p> : <ul className="space-y-2 text-sm">{hist.rows.map(h => (
          <li key={h.id} className="border-t border-astro-border pt-1.5"><p><b>{who(h.actor_id)}</b> {h.action === 'insert' ? 'creó la tarea' : h.action === 'delete' ? 'eliminó la tarea' : 'editó:'} <span className="text-xs text-astro-gray">{new Date(h.created_at).toLocaleString('es-PE')}</span></p>
            {h.action === 'update' && Object.entries(h.changes).filter(([k]) => FL[k]).map(([k, c]: any) => <p key={k} className="text-xs text-astro-gray">{FL[k]}: {String(val(k, c.old))} → {String(val(k, c.new))}</p>)}</li>))}</ul>}
      </Modal>}
    </div>
  )
}
