import { useCallback, useEffect, useState } from 'react'
import { supabase, money } from './lib'
import { Modal, Field } from './ui'

type Sum = { income_total: number; revenue: number; other_income: number; expenses_total: number; inventory_purchases: number; operating_expenses: number; net_profit: number; cash_flow: number }
type Mv = { id: string; kind: 'income' | 'expense'; concept: string; amount: number; date: string; category: string; responsible_id: string | null; receipt_path: string | null; notes: string | null }
const EXP: Record<string, string> = { inventory_purchase: 'Compra de productos', commission: 'Comisiones', advertising: 'Publicidad', services: 'Servicios', tools: 'Herramientas', other: 'Otros gastos' }
const INC: Record<string, string> = { otros: 'Otros ingresos', servicio: 'Servicios', reembolso: 'Reembolso de proveedor' }
const pad = (n: number) => String(n).padStart(2, '0')
const bounds = (ym: string, off = 0): [string, string, string] => { const [y, m] = ym.split('-').map(Number); const a = new Date(y, m - 1 + off, 1), b = new Date(y, m + off, 0)
  return [`${a.getFullYear()}-${pad(a.getMonth() + 1)}-01`, `${b.getFullYear()}-${pad(b.getMonth() + 1)}-${pad(b.getDate())}`, `${a.getFullYear()}-${pad(a.getMonth() + 1)}`] }
const empty = (uid: string, kind: 'income' | 'expense') => ({ id: '', kind, concept: '', amount: '', date: new Date().toISOString().slice(0, 10), category: kind === 'expense' ? 'other' : 'otros', responsible: uid, notes: '', receipt: '' as string, file: null as File | null })

export default function Finance({ ws, uid }: { ws: { id: string }; uid: string }) {
  const now = new Date(), [ym, setYm] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)
  const [sum, setSum] = useState<Sum | null>(null), [mv, setMv] = useState<Mv[]>([]), [months, setMonths] = useState<(Sum & { ym: string })[]>([])
  const [mem, setMem] = useState<{ user_id: string; profiles: { full_name: string | null; email: string | null } | null }[]>([])
  const [f, setF] = useState<ReturnType<typeof empty> | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [a, b] = bounds(ym)
    const hist = await Promise.all([5, 4, 3, 2, 1, 0].map(o => { const [x, y, k] = bounds(ym, -o); return supabase.rpc('dashboard_summary', { p_workspace: ws.id, p_from: x, p_to: y }).then(r => ({ r, k })) }))
    const [e, i, m] = await Promise.all([
      supabase.from('expenses').select('*').eq('workspace_id', ws.id).gte('expense_date', a).lte('expense_date', b),
      supabase.from('income').select('*').eq('workspace_id', ws.id).gte('income_date', a).lte('income_date', b),
      supabase.from('workspace_members').select('user_id,profiles(full_name,email)').eq('workspace_id', ws.id)])
    const bad = e.error || i.error || m.error || hist.find(h => h.r.error)?.r.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); setLoading(false); return }
    setErr(''); setMem(m.data as any); setMonths(hist.map(h => ({ ...(h.r.data as Sum), ym: h.k }))); setSum(hist[5].r.data as Sum)
    setMv([...(e.data as any[]).map(x => ({ ...x, kind: 'expense' as const, date: x.expense_date })), ...(i.data as any[]).map(x => ({ ...x, kind: 'income' as const, date: x.income_date }))]
      .sort((p, q) => q.date.localeCompare(p.date))); setLoading(false)
  }, [ws.id, ym])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    const ch = supabase.channel('fin-' + ws.id)
    for (const t of ['expenses', 'income', 'sales', 'sale_items']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `workspace_id=eq.${ws.id}` }, load)
    ch.subscribe(); return () => { supabase.removeChannel(ch) }
  }, [ws.id, load])

  const who = (id: string | null) => { const m = mem.find(x => x.user_id === id); return m?.profiles?.full_name || m?.profiles?.email || '—' }
  function edit(m?: Mv) { setErr(''); setF(m ? { id: m.id, kind: m.kind, concept: m.concept, amount: String(m.amount), date: m.date, category: m.category, responsible: m.responsible_id ?? uid, notes: m.notes ?? '', receipt: m.receipt_path ?? '', file: null } : empty(uid, 'expense')) }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f || busy) return
    const amount = Number(f.amount.replace(',', '.'))
    if (!f.concept.trim()) return setErr('Indica el concepto.'); if (!(amount > 0)) return setErr('El importe debe ser mayor a 0.')
    if (f.file && f.file.size > 5 * 1024 * 1024) return setErr('El comprobante no puede pasar de 5 MB.')
    setBusy(true); setErr('')
    let path = f.receipt || null
    if (f.file) {
      path = `${ws.id}/${crypto.randomUUID()}-${f.file.name.replace(/[^\w.\-]/g, '_')}`
      const up = await supabase.storage.from('receipts').upload(path, f.file, { contentType: f.file.type })
      if (up.error) { setBusy(false); return setErr('No se pudo subir el comprobante: ' + up.error.message) }
    }
    const date = f.kind === 'expense' ? { expense_date: f.date } : { income_date: f.date }
    const body = { concept: f.concept.trim(), amount, category: f.category, responsible_id: f.responsible || null, receipt_path: path, notes: f.notes || null, ...date }
    const tbl = f.kind === 'expense' ? 'expenses' : 'income'
    const { error } = f.id ? await supabase.from(tbl).update(body).eq('id', f.id) : await supabase.from(tbl).insert({ ...body, workspace_id: ws.id, created_by: uid })
    setBusy(false); if (error) return setErr(error.message); setF(null); load()
  }
  async function del(m: Mv) {
    if (!window.confirm(`¿Eliminar "${m.concept}"?`)) return
    const { error } = await supabase.from(m.kind === 'expense' ? 'expenses' : 'income').delete().eq('id', m.id)
    if (error) return setErr(error.message); if (m.receipt_path) await supabase.storage.from('receipts').remove([m.receipt_path]); load()
  }
  async function view(p: string) { const { data, error } = await supabase.storage.from('receipts').createSignedUrl(p, 60); if (error) setErr(error.message); else window.open(data.signedUrl, '_blank', 'noopener') }
  const shift = (n: number) => setYm(bounds(ym, n)[2])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Finanzas</h2>
        <button className="btn-ghost" onClick={() => shift(-1)}>←</button><input type="month" className="input !w-auto" value={ym} onChange={e => e.target.value && setYm(e.target.value)} /><button className="btn-ghost" onClick={() => shift(1)}>→</button>
        <button className="btn" onClick={() => edit()}>Registrar movimiento</button></div>
      {err && !f && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      {sum && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([['Ingresos', money(sum.income_total), `Ventas ${money(sum.revenue)} + otros ${money(sum.other_income)}`], ['Egresos', money(sum.expenses_total), `Inventario ${money(sum.inventory_purchases)} · operativos ${money(sum.operating_expenses)}`],
          ['Balance (flujo de caja)', money(sum.cash_flow), 'Ingresos − egresos'], ['Rentabilidad', money(sum.net_profit), 'Ganancia neta: no resta compras de inventario para no duplicar el costo']] as string[][]).map(([l, v, s]) =>
          <div className="card" key={l}><p className="text-xs text-astro-gray">{l}</p><p className={`text-xl font-semibold ${v.includes('-') ? 'text-red-400' : ''}`}>{v}</p><p className="text-xs text-astro-gray mt-1">{s}</p></div>)}</div>}
      <section className="card !p-0 overflow-x-auto">
        <h3 className="font-medium p-3 pb-1">Movimientos del mes <span className="text-xs text-astro-gray">(las ventas se gestionan en Ventas)</span></h3>
        <table className="w-full text-sm min-w-[720px]"><thead className="text-left text-astro-gray text-xs"><tr>{['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Responsable', 'Importe', ''].map(h => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead><tbody>
          {loading ? <tr><td colSpan={7} className="p-5 text-center text-astro-gray">Cargando…</td></tr> : mv.length === 0 ? <tr><td colSpan={7} className="p-5 text-center text-astro-gray">Sin movimientos en este mes.</td></tr> : mv.map(m => (
            <tr key={m.kind + m.id} className="border-t border-astro-border"><td className="px-3 py-2 text-astro-gray whitespace-nowrap">{m.date}</td><td className={`px-3 py-2 ${m.kind === 'income' ? 'text-astro-violet-300' : 'text-astro-gray'}`}>{m.kind === 'income' ? 'Ingreso' : 'Egreso'}</td>
              <td className="px-3 py-2">{m.concept}{m.notes && <span className="block text-xs text-astro-gray">{m.notes}</span>}</td><td className="px-3 py-2 text-astro-gray">{(m.kind === 'expense' ? EXP : INC)[m.category] ?? m.category}</td>
              <td className="px-3 py-2 text-astro-gray">{who(m.responsible_id)}</td><td className="px-3 py-2">{m.kind === 'expense' ? '−' : ''}{money(m.amount)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap space-x-2 text-astro-violet-300">{m.receipt_path && <button onClick={() => view(m.receipt_path!)}>Comprobante</button>}<button onClick={() => edit(m)}>Editar</button><button className="text-red-400" onClick={() => del(m)}>Eliminar</button></td></tr>))}
        </tbody></table>
      </section>
      <section className="card overflow-x-auto"><h3 className="font-medium mb-2">Reporte mensual (últimos 6 meses)</h3>
        <table className="w-full text-sm min-w-[520px]"><thead className="text-left text-astro-gray text-xs"><tr>{['Mes', 'Ingresos', 'Egresos', 'Flujo de caja', 'Ganancia neta'].map(h => <th key={h} className="py-1 font-normal">{h}</th>)}</tr></thead><tbody>
          {months.map(m => <tr key={m.ym} className="border-t border-astro-border"><td className="py-1.5">{m.ym}</td><td>{money(m.income_total)}</td><td>{money(m.expenses_total)}</td><td className={m.cash_flow < 0 ? 'text-red-400' : ''}>{money(m.cash_flow)}</td><td className={m.net_profit < 0 ? 'text-red-400' : ''}>{money(m.net_profit)}</td></tr>)}</tbody></table></section>

      {f && <Modal title={f.id ? 'Editar movimiento' : 'Registrar movimiento'} onClose={() => setF(null)}>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <Field label="Tipo"><select className="input" disabled={!!f.id} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as any, category: e.target.value === 'expense' ? 'other' : 'otros' })}><option value="expense">Egreso</option><option value="income">Otro ingreso</option></select></Field>
          <Field label="Categoría"><select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{Object.entries(f.kind === 'expense' ? EXP : INC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Concepto *" className="sm:col-span-2"><input className="input" value={f.concept} onChange={e => setF({ ...f, concept: e.target.value })} required /></Field>
          <Field label="Importe (S/) *"><input className="input" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required /></Field>
          <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="Propietario responsable"><select className="input" value={f.responsible} onChange={e => setF({ ...f, responsible: e.target.value })}>{mem.map(m => <option key={m.user_id} value={m.user_id}>{who(m.user_id)}</option>)}</select></Field>
          <Field label={f.receipt ? 'Reemplazar comprobante' : 'Comprobante (opcional, ≤ 5 MB)'}><input className="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setF({ ...f, file: e.target.files?.[0] ?? null })} /></Field>
          <Field label="Observaciones" className="sm:col-span-2"><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
          {f.kind === 'expense' && f.category === 'inventory_purchase' && <p className="sm:col-span-2 text-xs text-astro-gray">Las compras de inventario cuentan como egreso de caja, pero el costo se descuenta de la ganancia al vender (no se duplica).</p>}
          {err && <p className="sm:col-span-2 text-sm text-red-400">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={() => setF(null)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
        </form></Modal>}
    </div>
  )
}
