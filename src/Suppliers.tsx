import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, money, iso } from './lib'
import { Modal, Field } from './ui'

type S = { id: string; name: string; url: string | null; has_official_api: boolean; integration_notes: string | null; notes: string | null }
type Q = { id: string; supplier_id: string; product_name: string; price: number; availability: string; quoted_at: string; recheck_after: string | null; notes: string | null }
const AV: Record<string, string> = { available: 'Disponible', limited: 'Limitado', unavailable: 'Agotado', unknown: 'Sin verificar' }
const plus = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x) }
const today = () => iso(new Date())
const SEMPTY = { id: '', name: '', url: '', has_official_api: false, integration_notes: '', notes: '' }
const qEmpty = (sid: string) => ({ id: '', supplier_id: sid, product_name: '', price: '', availability: 'unknown', quoted_at: today(), recheck_after: plus(today(), 7), notes: '' })

export default function Suppliers({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [sups, setSups] = useState<S[]>([]), [qs, setQs] = useState<Q[]>([]), [sel, setSel] = useState('')
  const [sf, setSf] = useState<typeof SEMPTY | null>(null), [qf, setQf] = useState<ReturnType<typeof qEmpty> | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [s, q] = await Promise.all([supabase.from('suppliers').select('*').eq('workspace_id', ws.id).order('name'),
      supabase.from('supplier_quotes').select('*').eq('workspace_id', ws.id).order('quoted_at', { ascending: false })])
    if (s.error || q.error) { setErr('No se pudo cargar: ' + (s.error || q.error)!.message); setLoading(false); return }
    setSups(s.data as S[]); setQs(q.data as Q[]); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase.channel('sup-' + ws.id)
    for (const t of ['suppliers', 'supplier_quotes']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); return () => { supabase.removeChannel(ch) }
  }, [ws.id, load])
  useEffect(() => { if (!sel && sups[0]) setSel(sups[0].id) }, [sups, sel])

  const name = (id: string) => sups.find(s => s.id === id)?.name ?? '—'
  const stale = (q: Q) => !q.recheck_after || q.recheck_after < today()
  const mine = qs.filter(q => q.supplier_id === sel)
  const compare = useMemo(() => {
    const g = new Map<string, Map<string, Q>>()
    for (const q of qs) { const k = q.product_name.trim().toLowerCase(); const m = g.get(k) ?? new Map(); if (!m.has(q.supplier_id)) m.set(q.supplier_id, q); g.set(k, m) }  // qs viene ordenado: la primera es la más reciente
    return [...g.values()].filter(m => m.size > 1).map(m => [...m.values()].sort((a, b) => a.price - b.price))
  }, [qs])

  async function saveS(e: React.FormEvent) {
    e.preventDefault(); if (!sf) return
    if (!sf.name.trim()) return setErr('El nombre es obligatorio.')
    const body = { name: sf.name.trim(), url: sf.url || null, has_official_api: sf.has_official_api, integration_notes: sf.integration_notes || null, notes: sf.notes || null }
    setBusy(true); setErr('')
    const { error } = sf.id ? await supabase.from('suppliers').update(body).eq('id', sf.id) : await supabase.from('suppliers').insert({ ...body, workspace_id: ws.id, created_by: uid })
    setBusy(false); if (error) return setErr(error.message); setSf(null); load()
  }
  async function delS(s: S) {
    if (!window.confirm(`¿Eliminar "${s.name}" y todas sus cotizaciones? Los productos quedarán sin proveedor.`)) return
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id); if (error) setErr(error.message); else { setSel(''); load() }
  }
  async function saveQ(e: React.FormEvent) {
    e.preventDefault(); if (!qf) return
    const price = Number(qf.price.replace(',', '.'))
    if (!qf.product_name.trim()) return setErr('Indica el producto cotizado.')
    if (!Number.isFinite(price) || price < 0 || qf.price === '') return setErr('El precio debe ser un número válido (≥ 0).')
    if (qf.recheck_after && qf.recheck_after < qf.quoted_at) return setErr('La fecha de re-verificación no puede ser anterior a la consulta.')
    const body = { supplier_id: qf.supplier_id, product_name: qf.product_name.trim(), price, availability: qf.availability, quoted_at: qf.quoted_at, recheck_after: qf.recheck_after || null, notes: qf.notes || null }
    setBusy(true); setErr('')
    const { error } = qf.id ? await supabase.from('supplier_quotes').update(body).eq('id', qf.id) : await supabase.from('supplier_quotes').insert({ ...body, workspace_id: ws.id, created_by: uid })
    setBusy(false); if (error) return setErr(error.message); setQf(null); load()
  }
  async function delQ(q: Q) { if (window.confirm('¿Eliminar esta cotización?')) { const { error } = await supabase.from('supplier_quotes').delete().eq('id', q.id); if (error) setErr(error.message); else load() } }

  const cur = sups.find(s => s.id === sel)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Proveedores</h2>
        <button className="btn" onClick={() => { setErr(''); setSf(SEMPTY) }}>Nuevo proveedor</button></div>
      {err && !sf && !qf && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      {loading ? <p className="text-astro-gray">Cargando…</p> : sups.length === 0 ? <div className="card text-sm text-astro-gray">Aún no hay proveedores. Agrega, por ejemplo, vip.mendeztec.com o tiendadigitalperu.com y registra sus cotizaciones a mano.</div> : <>
        <div className="flex gap-2 overflow-x-auto">{sups.map(s => <button key={s.id} onClick={() => setSel(s.id)}
          className={`px-3 py-1.5 rounded-xl border text-sm whitespace-nowrap ${sel === s.id ? 'border-astro-violet-500 bg-astro-surface2' : 'border-astro-border text-astro-gray'}`}>{s.name}</button>)}</div>
        {cur && <section className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium mr-auto">{cur.name}</h3>
            <button className="text-sm text-astro-violet-300" onClick={() => { setErr(''); setSf({ id: cur.id, name: cur.name, url: cur.url ?? '', has_official_api: cur.has_official_api, integration_notes: cur.integration_notes ?? '', notes: cur.notes ?? '' }) }}>Editar</button>
            <button className="text-sm text-red-400" onClick={() => delS(cur)}>Eliminar</button></div>
          <p className="text-sm text-astro-gray">{cur.url && <a className="text-astro-violet-300 underline" href={cur.url} target="_blank" rel="noreferrer noopener">{cur.url}</a>}
            {' · '}{cur.has_official_api ? 'Integración oficial confirmada' : 'Sin integración oficial confirmada: las cotizaciones se registran a mano'}</p>
          {cur.integration_notes && <p className="text-sm">{cur.integration_notes}</p>}{cur.notes && <p className="text-sm text-astro-gray">{cur.notes}</p>}
        </section>}
        <section className="card !p-0 overflow-x-auto">
          <div className="flex items-center p-3"><h3 className="font-medium mr-auto">Cotizaciones</h3><button className="btn !py-1 text-sm" onClick={() => { setErr(''); setQf(qEmpty(sel)) }}>Registrar cotización</button></div>
          <table className="w-full text-sm min-w-[720px]"><thead className="text-left text-astro-gray text-xs"><tr>{['Producto', 'Precio', 'Disponibilidad', 'Consultado', 'Verificar de nuevo', ''].map(h => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead><tbody>
            {mine.length === 0 ? <tr><td colSpan={6} className="p-5 text-center text-astro-gray">Sin cotizaciones para este proveedor.</td></tr> : mine.map(q => (
              <tr key={q.id} className="border-t border-astro-border"><td className="px-3 py-2">{q.product_name}</td><td className="px-3 py-2">{money(q.price)}</td>
                <td className="px-3 py-2">{AV[q.availability]}{stale(q) && q.availability !== 'unknown' && <span className="block text-xs text-amber-400">Dato vencido: no confirmado hoy</span>}</td>
                <td className="px-3 py-2 text-astro-gray">{q.quoted_at}</td>
                <td className={`px-3 py-2 ${stale(q) ? 'text-amber-400' : 'text-astro-gray'}`}>{q.recheck_after ?? 'Sin fecha'}{stale(q) && ' · vencida'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap space-x-2 text-astro-violet-300"><button onClick={() => { setErr(''); setQf({ ...qEmpty(q.supplier_id), id: q.id, product_name: q.product_name, price: String(q.price), availability: q.availability, quoted_at: q.quoted_at, recheck_after: q.recheck_after ?? '', notes: q.notes ?? '' }) }}>Editar</button>
                  <button className="text-red-400" onClick={() => delQ(q)}>Eliminar</button></td></tr>))}
          </tbody></table>
        </section>
        <section className="card"><h3 className="font-medium mb-2">Comparación entre proveedores</h3>
          {compare.length === 0 ? <p className="text-sm text-astro-gray">Aparecerá cuando dos proveedores tengan cotizado el mismo producto (mismo nombre).</p> :
            <div className="space-y-3">{compare.map(g => <div key={g[0].product_name}><p className="font-medium text-sm">{g[0].product_name}</p>
              <ul className="text-sm space-y-0.5">{g.map((q, i) => <li key={q.id} className="flex justify-between gap-2"><span>{name(q.supplier_id)} <span className="text-astro-gray">· {AV[q.availability]} · {q.quoted_at}{stale(q) ? ' · verificar' : ''}</span></span>
                <b className={i === 0 && q.availability !== 'unavailable' ? 'text-astro-violet-300' : ''}>{money(q.price)}{i === 0 && q.availability !== 'unavailable' ? ' ★' : ''}</b></li>)}</ul></div>)}</div>}
        </section></>}

      {sf && <Modal title={sf.id ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={() => setSf(null)}>
        <form onSubmit={saveS} className="space-y-3">
          <Field label="Nombre *"><input className="input" value={sf.name} onChange={e => setSf({ ...sf, name: e.target.value })} required /></Field>
          <Field label="Sitio web"><input className="input" type="url" placeholder="https://" value={sf.url} onChange={e => setSf({ ...sf, url: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sf.has_official_api} onChange={e => setSf({ ...sf, has_official_api: e.target.checked })} /> Tiene API o exportación oficial (marcar solo si lo confirmaste)</label>
          <Field label="Notas de integración"><textarea className="input" rows={2} value={sf.integration_notes} onChange={e => setSf({ ...sf, integration_notes: e.target.value })} /></Field>
          <Field label="Notas"><textarea className="input" rows={2} value={sf.notes} onChange={e => setSf({ ...sf, notes: e.target.value })} /></Field>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setSf(null)}>Cancelar</button><button className="btn" disabled={busy}>Guardar</button></div>
        </form></Modal>}

      {qf && <Modal title={qf.id ? 'Editar cotización' : 'Registrar cotización'} onClose={() => setQf(null)}>
        <form onSubmit={saveQ} className="grid sm:grid-cols-2 gap-3">
          <Field label="Proveedor"><select className="input" value={qf.supplier_id} onChange={e => setQf({ ...qf, supplier_id: e.target.value })}>{sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Producto *"><input className="input" value={qf.product_name} onChange={e => setQf({ ...qf, product_name: e.target.value })} required /></Field>
          <Field label="Precio (S/) *"><input className="input" inputMode="decimal" value={qf.price} onChange={e => setQf({ ...qf, price: e.target.value })} required /></Field>
          <Field label="Disponibilidad"><select className="input" value={qf.availability} onChange={e => setQf({ ...qf, availability: e.target.value })}>{Object.entries(AV).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Fecha de consulta"><input className="input" type="date" value={qf.quoted_at} onChange={e => setQf({ ...qf, quoted_at: e.target.value })} required /></Field>
          <Field label="Verificar de nuevo el"><input className="input" type="date" value={qf.recheck_after} onChange={e => setQf({ ...qf, recheck_after: e.target.value })} /></Field>
          <Field label="Notas" className="sm:col-span-2"><input className="input" value={qf.notes} onChange={e => setQf({ ...qf, notes: e.target.value })} /></Field>
          {err && <p className="sm:col-span-2 text-sm text-red-400">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setQf(null)}>Cancelar</button><button className="btn" disabled={busy}>Guardar</button></div>
        </form></Modal>}
    </div>
  )
}
