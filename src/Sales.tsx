import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, money, iso } from './lib'
import { Modal, Field } from './ui'

type S = { id: string; sale_number: string; customer_name: string; sale_date: string; payment_method: string; responsible_id: string | null; status: string; notes: string | null; total: number; total_cost: number; profit: number; units: number }
type It = { id: string; sale_id: string; product_id: string | null; product_name: string; quantity: number; unit_price: number; unit_cost: number }
type P = { id: string; name: string; cost: number; sale_price: number; stock: number; status: string }
type Row = { pid: string; name: string; qty: string; price: string; cost: string }
const ST: Record<string, string> = { completed: 'Completada', pending: 'Pendiente', cancelled: 'Cancelada', refunded: 'Reembolsada' }
const PAY = ['yape', 'plin', 'transferencia', 'efectivo', 'tarjeta', 'paypal', 'otro']
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const friendly = (m: string) => m.includes('products_stock_nonnegative') ? 'Stock insuficiente: no se puede completar esta venta con el stock actual.' : m
const newRow = (): Row => ({ pid: '', name: '', qty: '1', price: '', cost: '0' })

export default function Sales({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [rows, setRows] = useState<S[]>([]), [items, setItems] = useState<It[]>([]), [prods, setProds] = useState<P[]>([])
  const [mem, setMem] = useState<{ user_id: string; profiles: { full_name: string | null; email: string | null } | null }[]>([])
  const [q, setQ] = useState(''), [st, setSt] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [f, setF] = useState<any>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [s, i, p, m] = await Promise.all([
      supabase.from('sales_summary').select('*').eq('workspace_id', ws.id).order('sale_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('sale_items').select('*').eq('workspace_id', ws.id),
      supabase.from('products').select('id,name,cost,sale_price,stock,status').eq('workspace_id', ws.id).order('name'),
      supabase.from('workspace_members').select('user_id,profiles(full_name,email)').eq('workspace_id', ws.id)])
    const bad = s.error || i.error || p.error || m.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); setLoading(false); return }
    setRows(s.data as S[]); setItems(i.data as It[]); setProds(p.data as P[]); setMem(m.data as any); setLoading(false)
  }, [ws.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase.channel('sales-' + ws.id)
    for (const t of ['sales', 'sale_items', 'products']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); return () => { supabase.removeChannel(ch) }
  }, [ws.id, load])

  const who = (id: string | null) => { const m = mem.find(x => x.user_id === id); return m?.profiles?.full_name || m?.profiles?.email || '—' }
  const byS = useMemo(() => { const g: Record<string, It[]> = {}; items.forEach(i => (g[i.sale_id] ??= []).push(i)); return g }, [items])
  const list = rows.filter(r => (!st || r.status === st) && (!from || r.sale_date >= from) && (!to || r.sale_date <= to) &&
    (!q.trim() || `${r.sale_number} ${r.customer_name}`.toLowerCase().includes(q.trim().toLowerCase())))
  const done = list.filter(r => r.status === 'completed')
  const tot = done.reduce((a, r) => a + Number(r.total), 0), prof = done.reduce((a, r) => a + Number(r.profit), 0)

  function open(s?: S) {
    setErr('')
    setF(s ? { id: s.id, customer: s.customer_name, date: s.sale_date, payment: s.payment_method, responsible: s.responsible_id ?? uid, status: s.status, notes: s.notes ?? '',
      rows: (byS[s.id] ?? []).map(i => ({ pid: i.product_id ?? '', name: i.product_name, qty: String(i.quantity), price: String(i.unit_price), cost: String(i.unit_cost) })) }
      : { id: '', customer: '', date: iso(new Date()), payment: 'yape', responsible: uid, status: 'completed', notes: '', rows: [newRow()] })
  }
  const setRow = (i: number, patch: Partial<Row>) => setF((x: any) => ({ ...x, rows: x.rows.map((r: Row, j: number) => j === i ? { ...r, ...patch } : r) }))
  function pickProd(i: number, pid: string) {
    const p = prods.find(x => x.id === pid)
    setRow(i, p ? { pid, name: p.name, price: String(p.sale_price), cost: String(p.cost) } : { pid: '' })
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return
    if (!f.customer.trim()) return setErr('Indica el cliente.')
    const its = f.rows.map((r: Row) => ({ product_id: r.pid || null, product_name: r.name.trim(), quantity: num(r.qty), unit_price: num(r.price), unit_cost: num(r.cost) }))
    if (its.some((i: any) => !i.product_name)) return setErr('Cada línea necesita un producto o un nombre.')
    if (its.some((i: any) => !Number.isInteger(i.quantity) || i.quantity < 1)) return setErr('Las cantidades deben ser enteros ≥ 1.')
    if (its.some((i: any) => !(i.unit_price >= 0) || !(i.unit_cost >= 0))) return setErr('Precio y costo deben ser números ≥ 0.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('save_sale', { p_id: f.id || null, p_customer: f.customer, p_date: f.date, p_payment: f.payment, p_responsible: f.responsible || null, p_status: f.status, p_notes: f.notes, p_items: its })
    setBusy(false); if (error) return setErr(friendly(error.message)); setF(null); load()
  }
  async function setStatus(s: S, status: string) {
    const { error } = await supabase.from('sales').update({ status }).eq('id', s.id)
    if (error) setErr(friendly(error.message)); else load()
  }
  async function del(s: S) {
    if (!window.confirm(`¿Eliminar la venta ${s.sale_number}? Si estaba completada, el stock se repone.`)) return
    const { error } = await supabase.from('sales').delete().eq('id', s.id); if (error) setErr(friendly(error.message)); else load()
  }
  const ftotal = f ? f.rows.reduce((a: number, r: Row) => a + (num(r.qty) || 0) * (num(r.price) || 0), 0) : 0
  const fprofit = f ? f.rows.reduce((a: number, r: Row) => a + (num(r.qty) || 0) * ((num(r.price) || 0) - (num(r.cost) || 0)), 0) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Ventas</h2><button className="btn" onClick={() => open()}>Nueva venta</button></div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input className="input col-span-2 md:col-span-1" placeholder="Cliente o N°…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" value={st} onChange={e => setSt(e.target.value)}><option value="">Todos los estados</option>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Desde" /><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Hasta" />
        <div className="card !py-1.5 text-xs text-astro-gray">Completadas: <b className="text-white">{money(tot)}</b><br />Ganancia: <b className="text-white">{money(prof)}</b></div>
      </div>
      {err && !f && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-left text-astro-gray text-xs"><tr>{['N°', 'Fecha', 'Cliente', 'Productos', 'Total', 'Ganancia', 'Pago · responsable', 'Estado', ''].map(h => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={9} className="p-6 text-center text-astro-gray">Cargando…</td></tr> : list.length === 0 ?
            <tr><td colSpan={9} className="p-6 text-center text-astro-gray">{rows.length ? 'Sin resultados.' : 'Aún no hay ventas registradas.'}</td></tr> : list.map(r => (
            <tr key={r.id} className="border-t border-astro-border align-top">
              <td className="px-3 py-2 whitespace-nowrap">{r.sale_number}</td><td className="px-3 py-2 whitespace-nowrap text-astro-gray">{r.sale_date}</td><td className="px-3 py-2">{r.customer_name}</td>
              <td className="px-3 py-2 text-astro-gray">{(byS[r.id] ?? []).map(i => `${i.quantity}× ${i.product_name}`).join(', ')}</td>
              <td className="px-3 py-2">{money(r.total)}</td><td className={`px-3 py-2 ${r.profit < 0 ? 'text-red-400' : ''}`}>{money(r.profit)}</td>
              <td className="px-3 py-2 text-astro-gray">{r.payment_method} · {who(r.responsible_id)}</td>
              <td className="px-3 py-2"><select className="bg-transparent text-sm" value={r.status} onChange={e => setStatus(r, e.target.value)}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k} className="bg-black">{l}</option>)}</select></td>
              <td className="px-3 py-2 text-right whitespace-nowrap space-x-2 text-astro-violet-300"><button onClick={() => open(r)}>Editar</button><button className="text-red-400" onClick={() => del(r)}>Eliminar</button></td></tr>))}</tbody>
        </table>
      </div>
      <p className="text-xs text-astro-gray">Solo las ventas completadas cuentan como ingreso. El stock baja al completar (o reembolsar) y se repone al cancelar o eliminar.</p>

      {f && <Modal title={f.id ? 'Editar venta' : 'Nueva venta'} onClose={() => setF(null)}>
        <form onSubmit={save} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Cliente *"><input className="input" value={f.customer} onChange={e => setF({ ...f, customer: e.target.value })} required /></Field>
            <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
            <Field label="Método de pago"><select className="input" value={f.payment} onChange={e => setF({ ...f, payment: e.target.value })}>{PAY.map(p => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Propietario responsable"><select className="input" value={f.responsible} onChange={e => setF({ ...f, responsible: e.target.value })}>{mem.map(m => <option key={m.user_id} value={m.user_id}>{who(m.user_id)}</option>)}</select></Field>
            <Field label="Estado"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Notas"><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <div className="space-y-2"><p className="text-sm text-astro-gray">Productos</p>
            {f.rows.map((r: Row, i: number) => { const p = prods.find(x => x.id === r.pid); return (
              <div key={i} className="grid grid-cols-6 gap-1.5 items-end">
                <select className="input col-span-6 sm:col-span-2" value={r.pid} onChange={e => pickProd(i, e.target.value)}><option value="">Otro (manual)</option>{prods.map(p => <option key={p.id} value={p.id}>{p.name} (stock {p.stock})</option>)}</select>
                {!r.pid && <input className="input col-span-6 sm:col-span-2" placeholder="Nombre" value={r.name} onChange={e => setRow(i, { name: e.target.value })} />}
                <input className="input" inputMode="numeric" title="Cantidad" placeholder="Cant." value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} />
                <input className="input" inputMode="decimal" title="Precio unitario" placeholder="Precio" value={r.price} onChange={e => setRow(i, { price: e.target.value })} />
                <input className="input" inputMode="decimal" title="Costo unitario" placeholder="Costo" value={r.cost} onChange={e => setRow(i, { cost: e.target.value })} />
                {f.rows.length > 1 && <button type="button" className="text-red-400 text-sm" onClick={() => setF({ ...f, rows: f.rows.filter((_: Row, j: number) => j !== i) })}>Quitar</button>}
                {p && f.status === 'completed' && num(r.qty) > p.stock && <p className="col-span-6 text-xs text-amber-400">Solo hay {p.stock} en stock.</p>}
              </div>) })}
            <button type="button" className="text-sm text-astro-violet-300" onClick={() => setF({ ...f, rows: [...f.rows, newRow()] })}>+ Añadir producto</button></div>
          <p className="text-sm">Total <b>{money(ftotal)}</b> · Ganancia <b className={fprofit < 0 ? 'text-red-400' : ''}>{money(fprofit)}</b></p>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setF(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar venta'}</button></div>
        </form></Modal>}
    </div>
  )
}
