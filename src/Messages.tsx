import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib'
import { Modal, Field } from './ui'

type T = { id: string; kind: string; name: string; body: string }
const KINDS: Record<string, string> = { entrega: 'Entrega', confirmacion_compra: 'Confirmación de compra', pago_pendiente: 'Pago pendiente', renovacion: 'Renovación', vencimiento: 'Vencimiento', atencion_cliente: 'Atención al cliente' }
const FIELDS: [string, string][] = [['cliente', 'Cliente'], ['producto', 'Producto'], ['usuario', 'Correo o usuario'], ['contrasena', 'Contraseña o credencial'], ['duracion', 'Duración'], ['garantia', 'Garantía'], ['vencimiento', 'Fecha de vencimiento'], ['instrucciones', 'Instrucciones']]
const SENSITIVE = ['usuario', 'contrasena']
const OPTIONAL = ['instrucciones']
const fmtDate = (d: string) => d.split('-').reverse().join('/')
const phoneFor = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 9 && d.startsWith('9') ? '51' + d : d }

export default function Messages({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [tpls, setTpls] = useState<T[]>([]), [sel, setSel] = useState(''), [customers, setCustomers] = useState<string[]>([]), [prods, setProds] = useState<{ id: string; name: string; duration: string | null; warranty: string | null }[]>([])
  const [v, setV] = useState<Record<string, string>>({}), [phone, setPhone] = useState(''), [show, setShow] = useState(false), [wipe, setWipe] = useState(true)
  const [ed, setEd] = useState<{ id: string; kind: string; name: string; body: string } | null>(null)
  const [err, setErr] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [t, c, p] = await Promise.all([
      supabase.from('message_templates').select('id,kind,name,body').eq('workspace_id', ws.id).order('kind').order('name'),
      supabase.from('sales').select('customer_name').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('products').select('id,name,duration,warranty').eq('workspace_id', ws.id).order('name')])
    const bad = t.error || c.error || p.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); setLoading(false); return }
    setTpls(t.data as T[]); setCustomers([...new Set((c.data as any[]).map(x => x.customer_name))]); setProds(p.data as any[]); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!sel && tpls[0]) setSel(tpls[0].id) }, [tpls, sel])

  const tpl = tpls.find(t => t.id === sel)
  const used = useMemo(() => tpl ? [...new Set([...tpl.body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))] : [], [tpl])
  const missing = used.filter(k => !OPTIONAL.includes(k) && !(v[k] ?? '').trim()).map(k => FIELDS.find(f => f[0] === k)?.[1] ?? k)
  const text = useMemo(() => {
    if (!tpl) return ''
    const val = (k: string) => k === 'vencimiento' && v[k] ? fmtDate(v[k]) : (v[k] ?? '').trim()
    return tpl.body.split('\n').filter(line => { const m = /^\s*\{\{(\w+)\}\}\s*$/.exec(line); return !(m && OPTIONAL.includes(m[1]) && !val(m[1])) })
      .map(line => line.replace(/\{\{(\w+)\}\}/g, (_, k) => val(k) || `[${FIELDS.find(f => f[0] === k)?.[1] ?? k}]`)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }, [tpl, v])

  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
  function pickProduct(name: string) {
    const p = prods.find(x => x.name === name); set('producto', name)
    if (p) setV(o => ({ ...o, producto: name, duracion: o.duracion || p.duration || '', garantia: o.garantia || p.warranty || '' }))
  }
  function clearSensitive() { setV(o => { const n = { ...o }; SENSITIVE.forEach(k => delete n[k]); return n }) }
  async function copy() {
    if (missing.length) return
    try { await navigator.clipboard.writeText(text) } catch { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove() }
    setNote(wipe ? 'Mensaje copiado. Usuario y contraseña se borraron de esta pantalla.' : 'Mensaje copiado.'); if (wipe) clearSensitive()
  }
  function whatsapp() {
    if (missing.length) return
    window.open(`https://wa.me/${phoneFor(phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); if (wipe) { clearSensitive(); setNote('Se abrió WhatsApp. Usuario y contraseña se borraron de esta pantalla.') }
  }
  async function saveT(e: React.FormEvent) {
    e.preventDefault(); if (!ed || busy) return
    if (!ed.name.trim() || !ed.body.trim()) return setErr('Nombre y texto son obligatorios.')
    setBusy(true); setErr('')
    const body = { kind: ed.kind, name: ed.name.trim(), body: ed.body }
    const { error } = ed.id ? await supabase.from('message_templates').update(body).eq('id', ed.id) : await supabase.from('message_templates').insert({ ...body, workspace_id: ws.id, created_by: uid })
    setBusy(false); if (error) return setErr(error.message.includes('duplicate') ? 'Ya existe una plantilla con ese tipo y nombre.' : error.message); setEd(null); load()
  }
  async function delT(t: T) {
    if (!window.confirm(`¿Eliminar la plantilla "${t.name}"?`)) return
    const { error } = await supabase.from('message_templates').delete().eq('id', t.id); if (error) setErr(error.message); else { setSel(''); load() }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Mensajes de entrega</h2><button className="btn-ghost" onClick={() => { setErr(''); setEd({ id: '', kind: 'entrega', name: '', body: '' }) }}>Nueva plantilla</button></div>
      {err && !ed && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      {loading ? <p className="text-astro-gray">Cargando…</p> : <div className="grid lg:grid-cols-2 gap-4">
        <section className="card space-y-3">
          <div className="flex gap-2 items-end">
            <label className="block text-sm flex-1"><span className="text-astro-gray">Plantilla</span><select className="input" value={sel} onChange={e => { setSel(e.target.value); setNote('') }}>
              {tpls.map(t => <option key={t.id} value={t.id}>{KINDS[t.kind]} · {t.name}</option>)}</select></label>
            {tpl && <><button className="text-sm text-astro-violet-300 pb-2" onClick={() => { setErr(''); setEd({ ...tpl }) }}>Editar</button><button className="text-sm text-red-400 pb-2" onClick={() => delT(tpl)}>Eliminar</button></>}
          </div>
          <datalist id="customers">{customers.map(c => <option key={c} value={c} />)}</datalist><datalist id="products">{prods.map(p => <option key={p.id} value={p.name} />)}</datalist>
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.filter(([k]) => used.includes(k)).map(([k, l]) => (
              <label key={k} className={`block text-sm ${k === 'instrucciones' ? 'sm:col-span-2' : ''}`}><span className="text-astro-gray">{l}{OPTIONAL.includes(k) ? ' (opcional)' : ''}</span>
                {k === 'instrucciones' ? <textarea className="input" rows={2} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} /> :
                  <input className="input" type={k === 'vencimiento' ? 'date' : k === 'contrasena' && !show ? 'password' : 'text'} list={k === 'cliente' ? 'customers' : k === 'producto' ? 'products' : undefined}
                    autoComplete="off" value={v[k] ?? ''} onChange={e => k === 'producto' ? pickProduct(e.target.value) : set(k, e.target.value)} />}</label>))}
            <label className="block text-sm"><span className="text-astro-gray">WhatsApp del cliente (opcional)</span><input className="input" inputMode="tel" placeholder="9XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-astro-gray">
            <label className="flex items-center gap-2"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Mostrar contraseña</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={wipe} onChange={e => setWipe(e.target.checked)} /> Borrar usuario y contraseña al copiar</label>
            <button className="text-astro-violet-300" onClick={() => { setV({}); setNote('') }}>Limpiar todo</button>
          </div>
        </section>
        <section className="card space-y-3">
          <h3 className="font-medium">Vista previa</h3>
          <pre className="whitespace-pre-wrap font-sans text-sm bg-astro-surface2 border border-astro-border rounded-xl p-3 min-h-[12rem]">{text || 'Elige una plantilla.'}</pre>
          {missing.length > 0 && <p className="text-xs text-amber-400">Falta: {missing.join(', ')}.</p>}
          <div className="flex gap-2"><button className="btn flex-1" disabled={!tpl || missing.length > 0} onClick={copy}>Copiar mensaje</button><button className="btn-ghost flex-1" disabled={!tpl || missing.length > 0} onClick={whatsapp}>Abrir en WhatsApp</button></div>
          {note && <p className="text-sm text-astro-violet-300">{note}</p>}
          <p className="text-xs text-astro-gray">Los datos del cliente solo existen en esta pantalla: no se guardan en la base de datos ni en el historial. Entrega cada cuenta respetando las condiciones de uso y las licencias del proveedor.</p>
        </section>
      </div>}

      {ed && <Modal title={ed.id ? 'Editar plantilla' : 'Nueva plantilla'} onClose={() => setEd(null)}>
        <form onSubmit={saveT} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Tipo"><select className="input" value={ed.kind} onChange={e => setEd({ ...ed, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Nombre"><input className="input" value={ed.name} onChange={e => setEd({ ...ed, name: e.target.value })} required /></Field></div>
          <Field label="Texto"><textarea className="input font-mono text-xs" rows={11} value={ed.body} onChange={e => setEd({ ...ed, body: e.target.value })} required /></Field>
          <div className="flex flex-wrap gap-1.5">{FIELDS.map(([k, l]) => <button type="button" key={k} className="btn-ghost !py-0.5 !px-2 text-xs" onClick={() => setEd({ ...ed, body: ed.body + `{{${k}}}` })}>{l}</button>)}</div>
          <p className="text-xs text-amber-400">Las plantillas se guardan en la base de datos: no escribas contraseñas ni credenciales reales en ellas; usa los campos {'{{usuario}}'} y {'{{contrasena}}'}.</p>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setEd(null)}>Cancelar</button><button className="btn" disabled={busy}>Guardar</button></div>
        </form></Modal>}
    </div>
  )
}
