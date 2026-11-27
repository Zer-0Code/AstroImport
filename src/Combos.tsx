import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, chan, money, iso } from './lib'
import { Modal, Field } from './ui'

type P = { id: string; name: string; cost: number; sale_price: number; status: string }
type C = { id: string; name: string; description: string | null; price: number; status: string }
type I = { combo_id: string; product_id: string; quantity: number }
type Row = { pid: string; qty: string }
const PAY = ['yape', 'plin', 'transferencia', 'efectivo', 'tarjeta', 'paypal', 'otro']
const ST: Record<string, string> = { completed: 'Completada', pending: 'Pendiente' }
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const friendly = (m: string) => m.includes('combos_workspace_id_name_key') ? 'Ya existe un combo con ese nombre.' : m.includes('products_stock_nonnegative') ? 'Stock insuficiente en alguno de los productos del combo.' : m

// Reparte el precio del combo entre sus productos (proporcional a su precio normal) sin perder ni un céntimo.
export function allocate(items: { product_id: string; name: string; qty: number; price: number; cost: number }[], total: number) {
  const units = items.flatMap(i => Array.from({ length: i.qty }, () => i)), sumW = units.reduce((a, u) => a + u.price, 0), cents = Math.round(total * 100)
  const raw = units.map(u => cents * (sumW > 0 ? u.price / sumW : 1 / units.length)), base = raw.map(Math.floor)
  let rest = cents - base.reduce((a, b) => a + b, 0)
  raw.map((r, i) => [r - Math.floor(r), i] as [number, number]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { base[i]++; rest-- } })
  const g = new Map<string, { product_id: string; product_name: string; quantity: number; unit_price: number; unit_cost: number }>()
  units.forEach((u, i) => { const k = u.product_id + ':' + base[i], x = g.get(k) ?? { product_id: u.product_id, product_name: u.name, quantity: 0, unit_price: base[i] / 100, unit_cost: u.cost }; x.quantity++; g.set(k, x) })
  return [...g.values()]
}

export default function Combos({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [combos, setCombos] = useState<C[]>([]), [items, setItems] = useState<I[]>([]), [prods, setProds] = useState<P[]>([])
  const [f, setF] = useState<{ id: string; name: string; description: string; price: string; status: string; rows: Row[]; margin: string } | null>(null)
  const [sell, setSell] = useState<{ c: C; customer: string; date: string; payment: string; status: string; price: string } | null>(null)
  const [q, setQ] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [c, i, p] = await Promise.all([supabase.from('combos').select('*').eq('workspace_id', ws.id).order('name'), supabase.from('combo_items').select('combo_id,product_id,quantity').eq('workspace_id', ws.id),
      supabase.from('products').select('id,name,cost,sale_price,status').eq('workspace_id', ws.id).order('name')])
    const bad = c.error || i.error || p.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); setLoading(false); return }
    setCombos(c.data as C[]); setItems(i.data as I[]); setProds(p.data as P[]); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = chan('combos-' + ws.id)
    for (const t of ['combos', 'combo_items', 'products']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); return () => { supabase.removeChannel(ch) }
  }, [ws.id, load])

  const prod = (id: string) => prods.find(p => p.id === id)
  const stats = (rows: { product_id: string; quantity: number }[]) => rows.reduce((a, r) => { const p = prod(r.product_id); return p ? { cost: a.cost + p.cost * r.quantity, regular: a.regular + p.sale_price * r.quantity } : a }, { cost: 0, regular: 0 })
  const byC = useMemo(() => { const g: Record<string, I[]> = {}; items.forEach(i => (g[i.combo_id] ??= []).push(i)); return g }, [items])
  const list = combos.filter(c => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()))

  const open = (c?: C, copy = false) => { setErr(''); setMsg(''); setF(c ? { id: copy ? '' : c.id, name: copy ? c.name + ' (copia)' : c.name, description: c.description ?? '', price: String(c.price), status: c.status, margin: '30',
    rows: (byC[c.id] ?? []).map(i => ({ pid: i.product_id, qty: String(i.quantity) })) } : { id: '', name: '', description: '', price: '', status: 'active', margin: '30', rows: [{ pid: '', qty: '1' }] }) }
  const fItems = f ? f.rows.filter(r => r.pid).map(r => ({ product_id: r.pid, quantity: num(r.qty) })) : []
  const fs = stats(fItems.map(i => ({ ...i, quantity: i.quantity || 0 }))), fprice = f ? num(f.price) : 0
  const suggested = f && fs.cost > 0 && num(f.margin) < 100 ? Math.ceil(fs.cost / (1 - num(f.margin) / 100) * 10) / 10 : NaN

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f || busy) return
    if (!f.name.trim()) return setErr('Ponle un nombre al combo.')
    if (!(fprice >= 0) || f.price === '') return setErr('Indica el precio del combo (≥ 0).')
    const merged = new Map<string, number>(); for (const i of fItems) { if (!Number.isInteger(i.quantity) || i.quantity < 1) return setErr('Las cantidades deben ser enteros ≥ 1.'); merged.set(i.product_id, (merged.get(i.product_id) ?? 0) + i.quantity) }
    if (merged.size < 2) return setErr('Un combo necesita al menos 2 productos distintos.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('save_combo', { p_id: f.id || null, p_name: f.name, p_description: f.description, p_price: fprice, p_status: f.status, p_items: [...merged].map(([product_id, quantity]) => ({ product_id, quantity })) })
    setBusy(false); if (error) return setErr(friendly(error.message)); setF(null); load()
  }
  async function del(c: C) { if (window.confirm(`¿Eliminar el combo "${c.name}"? Las ventas ya hechas no cambian.`)) { const { error } = await supabase.from('combos').delete().eq('id', c.id); if (error) setErr(error.message); else load() } }
  async function toggle(c: C) { const { error } = await supabase.from('combos').update({ status: c.status === 'active' ? 'inactive' : 'active' }).eq('id', c.id); if (error) setErr(error.message); else load() }

  const sellLines = sell ? allocate((byC[sell.c.id] ?? []).flatMap(i => { const p = prod(i.product_id); return p ? [{ product_id: p.id, name: p.name, qty: i.quantity, price: p.sale_price, cost: p.cost }] : [] }), num(sell.price) || 0) : []
  async function doSell(e: React.FormEvent) {
    e.preventDefault(); if (!sell || busy) return
    if (!sell.customer.trim()) return setErr('Indica el cliente.'); if (!(num(sell.price) >= 0)) return setErr('Precio inválido.'); if (!sellLines.length) return setErr('El combo no tiene productos disponibles.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('save_sale', { p_id: null, p_customer: sell.customer, p_date: sell.date, p_payment: sell.payment, p_responsible: uid, p_status: sell.status, p_notes: `Combo: ${sell.c.name}`, p_items: sellLines })
    setBusy(false); if (error) return setErr(friendly(error.message)); setSell(null); setMsg(`Venta del combo "${sell.c.name}" registrada. La verás en Ventas.`)
  }
  const sCost = sell ? stats(byC[sell.c.id] ?? []).cost : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Combos <span className="text-sm text-astro-gray">({list.length})</span></h2>
        <input className="input !w-48" placeholder="Buscar combo…" value={q} onChange={e => setQ(e.target.value)} /><button className="btn" onClick={() => open()}>Crear combo</button></div>
      {err && !f && !sell && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}{msg && <div className="card border-astro-violet-500/50 text-sm text-astro-violet-300">{msg}</div>}
      {loading ? <p className="text-astro-gray">Cargando…</p> : list.length === 0 ? <div className="card text-sm text-astro-gray">{combos.length ? 'Sin resultados.' : 'Aún no hay combos. Crea el primero juntando 2 o más productos del catálogo.'}</div> :
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{list.map(c => { const it = byC[c.id] ?? [], s = stats(it), profit = c.price - s.cost, margin = c.price > 0 ? profit / c.price * 100 : 0, save = s.regular > 0 ? (1 - c.price / s.regular) * 100 : 0
          return (<div key={c.id} className={`card card-hover flex flex-col gap-2 ${c.status === 'inactive' ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2"><div className="mr-auto"><p className="font-semibold">{c.name}</p>{c.description && <p className="text-xs text-astro-gray">{c.description}</p>}</div>{c.status === 'inactive' && <span className="text-xs text-astro-gray">Inactivo</span>}</div>
            <p className="text-sm text-astro-gray">{it.map(i => `${i.quantity}× ${prod(i.product_id)?.name ?? '—'}`).join(' + ')}</p>
            <div className="flex items-end justify-between"><p className="text-2xl font-bold">{money(c.price)}</p><p className="text-xs text-astro-gray text-right">Sueltos {money(s.regular)}{save > 0 && <span className="text-astro-violet-300"> · ahorro {save.toFixed(0)}%</span>}</p></div>
            <p className={`text-xs ${profit < 0 ? 'text-red-400' : 'text-astro-gray'}`}>Costo {money(s.cost)} · ganancia {money(profit)} · margen {margin.toFixed(1)}%</p>
            <div className="flex flex-wrap gap-2 pt-1 text-sm"><button className="btn !py-1 !px-3 text-sm" disabled={c.status === 'inactive'} onClick={() => { setErr(''); setMsg(''); setSell({ c, customer: '', date: iso(new Date()), payment: 'yape', status: 'completed', price: String(c.price) }) }}>Vender</button>
              <button className="text-astro-violet-300" onClick={() => open(c)}>Editar</button><button className="text-astro-violet-300" onClick={() => open(c, true)}>Duplicar</button>
              <button className="text-astro-gray" onClick={() => toggle(c)}>{c.status === 'active' ? 'Desactivar' : 'Activar'}</button><button className="text-red-400" onClick={() => del(c)}>Eliminar</button></div></div>) })}</div>}

      {f && <Modal title={f.id ? 'Editar combo' : 'Crear combo'} onClose={() => setF(null)}>
        <form onSubmit={save} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Nombre del combo *"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Estado"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></Field>
            <Field label="Descripción" className="sm:col-span-2"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field></div>
          <div className="space-y-2"><p className="text-sm text-astro-gray">Productos del combo</p>
            {f.rows.map((r, i) => <div key={i} className="grid grid-cols-6 gap-1.5"><select className="input col-span-4" value={r.pid} onChange={e => setF({ ...f, rows: f.rows.map((x, j) => j === i ? { ...x, pid: e.target.value } : x) })}>
              <option value="">Elige un producto…</option>{prods.filter(p => p.status === 'active' || p.id === r.pid).map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.sale_price)}</option>)}</select>
              <input className="input" inputMode="numeric" title="Cantidad" value={r.qty} onChange={e => setF({ ...f, rows: f.rows.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) })} />
              {f.rows.length > 1 ? <button type="button" className="text-red-400 text-sm" onClick={() => setF({ ...f, rows: f.rows.filter((_, j) => j !== i) })}>Quitar</button> : <span />}</div>)}
            <button type="button" className="text-sm text-astro-violet-300" onClick={() => setF({ ...f, rows: [...f.rows, { pid: '', qty: '1' }] })}>+ Añadir producto</button></div>
          <div className="grid grid-cols-2 gap-3 items-end"><Field label="Precio del combo (S/) *"><input className="input" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} required /></Field>
            <div className="flex gap-1.5 items-end"><Field label="Margen objetivo %" className="flex-1"><input className="input" inputMode="decimal" value={f.margin} onChange={e => setF({ ...f, margin: e.target.value })} /></Field>
              <button type="button" className="btn-ghost !py-2" disabled={isNaN(suggested)} onClick={() => setF({ ...f, price: String(suggested) })}>{isNaN(suggested) ? 'Calcular' : `Usar ${money(suggested)}`}</button></div></div>
          <p className={`text-sm ${fprice - fs.cost < 0 ? 'text-red-400' : 'text-astro-violet-300'}`}>Costo {money(fs.cost)} · sueltos {money(fs.regular)} · ganancia {money((fprice || 0) - fs.cost)}{fprice > 0 ? ` · margen ${(((fprice - fs.cost) / fprice) * 100).toFixed(1)}%` : ''}</p>
          {err && <p className="text-sm text-red-400">{err}</p>}<div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setF(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar combo'}</button></div>
        </form></Modal>}

      {sell && <Modal title={`Vender · ${sell.c.name}`} onClose={() => setSell(null)}>
        <form onSubmit={doSell} className="grid sm:grid-cols-2 gap-3">
          <Field label="Cliente *"><input className="input" value={sell.customer} onChange={e => setSell({ ...sell, customer: e.target.value })} required /></Field>
          <Field label="Fecha"><input className="input" type="date" value={sell.date} onChange={e => setSell({ ...sell, date: e.target.value })} required /></Field>
          <Field label="Método de pago"><select className="input" value={sell.payment} onChange={e => setSell({ ...sell, payment: e.target.value })}>{PAY.map(p => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Estado"><select className="input" value={sell.status} onChange={e => setSell({ ...sell, status: e.target.value })}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Precio final al cliente (S/) — puedes personalizarlo" className="sm:col-span-2"><input className="input" inputMode="decimal" value={sell.price} onChange={e => setSell({ ...sell, price: e.target.value })} /></Field>
          <p className={`sm:col-span-2 text-sm ${(num(sell.price) || 0) - sCost < 0 ? 'text-red-400' : 'text-astro-violet-300'}`}>Ganancia de esta venta: {money((num(sell.price) || 0) - sCost)} (costo {money(sCost)})</p>
          <p className="sm:col-span-2 text-xs text-astro-gray">Se registra como una sola venta con una línea por producto; el precio se reparte según el valor de cada uno y el costo real queda guardado.</p>
          {err && <p className="sm:col-span-2 text-sm text-red-400">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setSell(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Registrando…' : 'Registrar venta'}</button></div>
        </form></Modal>}
    </div>
  )
}
