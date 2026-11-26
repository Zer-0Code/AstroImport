import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, chan, money, CATEGORIES, catLabel } from './lib'
import { Modal, Field } from './ui'

type P = { id: string; name: string; description: string | null; category: string; supplier_id: string | null; cost: number; sale_price: number; stock: number; min_stock: number
  duration: string | null; warranty: string | null; delivery_mode: string | null; status: string; on_demand: boolean; unit_profit: number; margin_pct: number; updated_at: string }
type H = { id: number; old_cost: number | null; new_cost: number; old_price: number | null; new_price: number; changed_at: string; changed_by: string | null }
const EMPTY = { id: '', name: '', description: '', category: 'otros', supplier_id: '', cost: '0', sale_price: '0', stock: '0', min_stock: '0', duration: '', warranty: '', delivery_mode: '', status: 'active', on_demand: true }
type F = typeof EMPTY
const SORTS: [string, string][] = [['name', 'Nombre'], ['margin_pct', 'Margen'], ['unit_profit', 'Ganancia'], ['stock', 'Stock'], ['updated_at', 'Actualización']]

export default function Products({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [rows, setRows] = useState<P[]>([]), [sups, setSups] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState(''), [cat, setCat] = useState(''), [st, setSt] = useState(''), [sort, setSort] = useState('name')
  const [form, setForm] = useState<F | null>(null), [hist, setHist] = useState<{ p: P; rows: H[] } | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([supabase.from('products').select('*').eq('workspace_id', ws.id), supabase.from('suppliers').select('id,name').eq('workspace_id', ws.id).order('name')])
    if (p.error || s.error) { setErr('No se pudo cargar: ' + (p.error || s.error)!.message); setLoading(false); return }
    setRows(p.data as P[]); setSups(s.data as any[]); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = chan('prod-' + ws.id)
    for (const t of ['products', 'suppliers']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); return () => { supabase.removeChannel(ch) }
  }, [ws.id, load])

  const supName = (id: string | null) => sups.find(s => s.id === id)?.name ?? '—'
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => (!t || `${r.name} ${r.description ?? ''}`.toLowerCase().includes(t)) && (!cat || r.category === cat) && (!st || r.status === st))
      .sort((a: any, b: any) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'updated_at' ? b.updated_at.localeCompare(a.updated_at) : b[sort] - a[sort])
  }, [rows, q, cat, st, sort])

  function edit(p?: P) {
    setErr('')
    setForm(p ? { id: p.id, name: p.name, description: p.description ?? '', category: p.category, supplier_id: p.supplier_id ?? '', cost: String(p.cost), sale_price: String(p.sale_price),
      stock: String(p.stock), min_stock: String(p.min_stock), duration: p.duration ?? '', warranty: p.warranty ?? '', delivery_mode: p.delivery_mode ?? '', status: p.status, on_demand: p.on_demand } : EMPTY)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const n = (v: string) => Number(v.replace(',', '.'))
    const cost = n(form.cost), price = n(form.sale_price), stock = n(form.stock), min = n(form.min_stock)
    if (!form.name.trim()) return setErr('El nombre es obligatorio.')
    if (![cost, price].every(v => Number.isFinite(v) && v >= 0)) return setErr('Costo y precio deben ser números válidos (≥ 0).')
    if (![stock, min].every(v => Number.isInteger(v) && v >= 0)) return setErr('Stock y stock mínimo deben ser enteros (≥ 0).')
    const body = { name: form.name.trim(), description: form.description || null, category: form.category, supplier_id: form.supplier_id || null, cost, sale_price: price, stock, min_stock: min,
      duration: form.duration || null, warranty: form.warranty || null, delivery_mode: form.delivery_mode || null, status: form.status, on_demand: form.on_demand }
    setBusy(true); setErr('')
    const { error } = form.id ? await supabase.from('products').update(body).eq('id', form.id) : await supabase.from('products').insert({ ...body, workspace_id: ws.id, created_by: uid })
    setBusy(false)
    if (error) return setErr(error.message)
    setForm(null); load()
  }
  async function duplicate(p: P) {
    const { id, unit_profit, margin_pct, updated_at, ...rest } = p as any
    const { error } = await supabase.from('products').insert({ ...rest, name: p.name + ' (copia)', stock: 0, workspace_id: ws.id, created_by: uid, created_at: undefined })
    if (error) setErr(error.message); else load()
  }
  async function remove(p: P) {
    if (!window.confirm(`¿Eliminar "${p.name}"? Las ventas pasadas conservan su nombre y costo.`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) setErr(error.message); else load()
  }
  async function history(p: P) {
    const { data, error } = await supabase.from('product_price_history').select('*').eq('product_id', p.id).order('changed_at', { ascending: false })
    if (error) setErr(error.message); else setHist({ p, rows: data as H[] })
  }
  const set = (k: keyof F) => (e: React.ChangeEvent<any>) => setForm(f => f && { ...f, [k]: e.target.value })
  const preview = form ? (() => { const c = Number(form.cost), s = Number(form.sale_price); return s > 0 && Number.isFinite(c) ? `Margen ${(((s - c) / s) * 100).toFixed(1)}% · Ganancia ${money(s - c)} por unidad` : '' })() : ''

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <h2 className="text-lg font-semibold mr-auto">Productos <span className="text-sm text-astro-gray">({list.length})</span></h2>
        <button className="btn" onClick={() => edit()}>Nuevo producto</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input className="input col-span-2 md:col-span-1" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" value={cat} onChange={e => setCat(e.target.value)}><option value="">Todas las categorías</option>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={st} onChange={e => setSt(e.target.value)}><option value="">Todos los estados</option><option value="active">Activo</option><option value="inactive">Inactivo</option></select>
        <select className="input" value={sort} onChange={e => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>Ordenar: {l}</option>)}</select>
      </div>
      {err && !form && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-left text-astro-gray text-xs"><tr>{['Producto', 'Proveedor', 'Costo', 'Precio', 'Margen', 'Ganancia', 'Stock', ''].map(h => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="p-6 text-center text-astro-gray">Cargando…</td></tr> : list.length === 0 ?
              <tr><td colSpan={8} className="p-6 text-center text-astro-gray">{rows.length ? 'Sin resultados.' : 'Aún no hay productos. Crea el primero.'}</td></tr> :
              list.map(p => (
                <tr key={p.id} className="border-t border-astro-border">
                  <td className="px-3 py-2"><p className="font-medium">{p.name} {p.status === 'inactive' && <span className="text-xs text-astro-gray">(inactivo)</span>}</p><p className="text-xs text-astro-gray">{catLabel(p.category)}{p.duration ? ` · ${p.duration}` : ''}</p></td>
                  <td className="px-3 py-2 text-astro-gray">{supName(p.supplier_id)}</td>
                  <td className="px-3 py-2">{money(p.cost)}</td><td className="px-3 py-2">{money(p.sale_price)}</td>
                  <td className={`px-3 py-2 ${p.margin_pct < 0 ? 'text-red-400' : ''}`}>{p.margin_pct}%</td><td className="px-3 py-2">{money(p.unit_profit)}</td>
                  <td className="px-3 py-2">{p.on_demand ? <span className="text-astro-gray text-xs">Bajo encargo</span> : <>{p.stock}{p.status === 'active' && p.stock <= p.min_stock && <span className="ml-1 text-xs text-amber-400">{p.stock === 0 ? 'Sin stock' : 'Bajo'}</span>}</>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right space-x-2 text-astro-violet-300">
                    <button onClick={() => edit(p)}>Editar</button><button onClick={() => duplicate(p)}>Duplicar</button><button onClick={() => history(p)}>Precios</button>
                    <button className="text-red-400" onClick={() => remove(p)}>Eliminar</button></td></tr>))}
          </tbody>
        </table>
      </div>

      {form && <Modal title={form.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setForm(null)}>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <Field label="Nombre *" className="sm:col-span-2"><input className="input" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Descripción" className="sm:col-span-2"><textarea className="input" rows={2} value={form.description} onChange={set('description')} /></Field>
          <Field label="Categoría"><select className="input" value={form.category} onChange={set('category')}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Proveedor"><select className="input" value={form.supplier_id} onChange={set('supplier_id')}><option value="">Sin proveedor</option>{sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Costo (S/)"><input className="input" inputMode="decimal" value={form.cost} onChange={set('cost')} /></Field>
          <Field label="Precio de venta (S/)"><input className="input" inputMode="decimal" value={form.sale_price} onChange={set('sale_price')} /></Field>
          {preview && <p className="sm:col-span-2 text-sm text-astro-violet-300">{preview}</p>}
          <label className="sm:col-span-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.on_demand} onChange={e => setForm(f => f && { ...f, on_demand: e.target.checked })} /><span>Producto <b>bajo encargo</b>: se compra al proveedor cuando el cliente paga, sin controlar stock.</span></label>
          {!form.on_demand && <><Field label="Stock"><input className="input" inputMode="numeric" value={form.stock} onChange={set('stock')} /></Field>
          <Field label="Stock mínimo"><input className="input" inputMode="numeric" value={form.min_stock} onChange={set('min_stock')} /></Field></>}
          <Field label="Duración"><input className="input" placeholder="Ej. 1 mes" value={form.duration} onChange={set('duration')} /></Field>
          <Field label="Garantía"><input className="input" placeholder="Ej. 30 días" value={form.warranty} onChange={set('warranty')} /></Field>
          <Field label="Modalidad de entrega"><input className="input" placeholder="Ej. Cuenta compartida" value={form.delivery_mode} onChange={set('delivery_mode')} /></Field>
          <Field label="Estado"><select className="input" value={form.status} onChange={set('status')}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></Field>
          {err && <p className="sm:col-span-2 text-sm text-red-400">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
        </form></Modal>}

      {hist && <Modal title={`Historial de precios · ${hist.p.name}`} onClose={() => setHist(null)}>
        {hist.rows.length === 0 ? <p className="text-sm text-astro-gray">Sin registros.</p> :
          <table className="w-full text-sm"><thead className="text-astro-gray text-xs text-left"><tr><th>Fecha</th><th>Costo</th><th>Precio</th></tr></thead><tbody>
            {hist.rows.map(h => <tr key={h.id} className="border-t border-astro-border"><td className="py-1.5">{new Date(h.changed_at).toLocaleString('es-PE')}</td>
              <td>{h.old_cost !== null && h.old_cost !== h.new_cost ? `${money(h.old_cost)} → ` : ''}{money(h.new_cost)}</td>
              <td>{h.old_price !== null && h.old_price !== h.new_price ? `${money(h.old_price)} → ` : ''}{money(h.new_price)}</td></tr>)}</tbody></table>}
      </Modal>}
    </div>
  )
}
