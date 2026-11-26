import { useCallback, useEffect, useState } from 'react'
import { supabase, money, rangeFor, iso, catLabel } from './lib'

type Kind = 'text' | 'money' | 'pct' | 'int'
type Col = { h: string; k: Kind }
type Cell = string | number
type Rep = { cols: Col[]; rows: Cell[][]; foot?: Cell[]; note?: string }
const REPORTS: [string, string][] = [['sales', 'Ventas'], ['profit', 'Ganancias'], ['expenses', 'Egresos'], ['products', 'Productos'], ['owners', 'Por propietario'], ['profitability', 'Rentabilidad']]
const RANGES = [['today', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['month', 'Este mes'], ['prev', 'Mes anterior'], ['custom', 'Personalizado']]
const SL: Record<string, string> = { completed: 'Completada', pending: 'Pendiente', cancelled: 'Cancelada', refunded: 'Reembolsada' }
const EXP: Record<string, string> = { inventory_purchase: 'Compra de productos', commission: 'Comisiones', advertising: 'Publicidad', services: 'Servicios', tools: 'Herramientas', other: 'Otros gastos' }
const fmt = (v: Cell, k: Kind) => typeof v === 'number' ? (k === 'money' ? money(v) : k === 'pct' ? `${v.toFixed(1)}%` : String(v)) : v
const csvCell = (v: Cell, k: Kind) => { let s = typeof v === 'number' ? (k === 'int' ? String(v) : v.toFixed(2)) : v; if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export default function Reports({ ws }: { ws: { id: string; name: string } }) {
  const [kind, setKind] = useState('sales'), [rk, setRk] = useState('month'), [from, setFrom] = useState(iso(new Date())), [to, setTo] = useState(iso(new Date()))
  const [rep, setRep] = useState<Rep | null>(null), [err, setErr] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [a, b] = rangeFor(rk, from, to)
  const title = REPORTS.find(r => r[0] === kind)![1]

  const build = useCallback(async (): Promise<Rep> => {
    if (a > b) throw new Error('La fecha inicial no puede ser posterior a la final.')
    const ok = <T,>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T }
    const mem = ok(await supabase.from('workspace_members').select('user_id,share_percent,profiles(full_name,email)').eq('workspace_id', ws.id)) as any[]
    const who = (id: string | null) => { const m = mem.find(x => x.user_id === id); return m?.profiles?.full_name || m?.profiles?.email || '—' }
    const sales = async () => ok(await supabase.from('sales_summary').select('*').eq('workspace_id', ws.id).gte('sale_date', a).lte('sale_date', b).order('sale_date')) as any[]
    const exps = async () => ok(await supabase.from('expenses').select('*').eq('workspace_id', ws.id).gte('expense_date', a).lte('expense_date', b).order('expense_date')) as any[]
    const soldItems = async () => {
      const s = (await sales()).filter(x => x.status === 'completed'), ids = new Set(s.map(x => x.id))
      const it = ok(await supabase.from('sale_items').select('sale_id,product_id,product_name,quantity,unit_price,unit_cost').eq('workspace_id', ws.id)) as any[]
      return { s, items: it.filter(i => ids.has(i.sale_id)) }
    }
    const byProduct = (items: any[]) => { const g = new Map<string, { name: string; id: string | null; u: number; rev: number; cost: number }>()
      for (const i of items) { const k = i.product_id ?? 'n:' + i.product_name.toLowerCase(), x = g.get(k) ?? { name: i.product_name, id: i.product_id, u: 0, rev: 0, cost: 0 }
        x.u += i.quantity; x.rev += i.quantity * i.unit_price; x.cost += i.quantity * i.unit_cost; g.set(k, x) } return [...g.values()] }

    if (kind === 'sales') {
      const s = await sales(), d = s.filter(x => x.status === 'completed')
      return { cols: [{ h: 'N°', k: 'text' }, { h: 'Fecha', k: 'text' }, { h: 'Cliente', k: 'text' }, { h: 'Estado', k: 'text' }, { h: 'Pago', k: 'text' }, { h: 'Responsable', k: 'text' }, { h: 'Total', k: 'money' }, { h: 'Ganancia', k: 'money' }],
        rows: s.map(x => [x.sale_number, x.sale_date, x.customer_name, SL[x.status], x.payment_method, who(x.responsible_id), +x.total, +x.profit]),
        foot: ['', '', '', '', '', `Completadas (${d.length})`, d.reduce((t, x) => t + +x.total, 0), d.reduce((t, x) => t + +x.profit, 0)], note: 'Los totales solo incluyen ventas completadas.' }
    }
    if (kind === 'profit') {
      const ser = ok(await supabase.rpc('dashboard_series', { p_workspace: ws.id, p_from: a, p_to: b })) as any[]
      const sm = ok(await supabase.rpc('dashboard_summary', { p_workspace: ws.id, p_from: a, p_to: b })) as any
      return { cols: [{ h: 'Día', k: 'text' }, { h: 'Ingresos', k: 'money' }, { h: 'Egresos', k: 'money' }, { h: 'Ganancia neta', k: 'money' }],
        rows: ser.filter(r => +r.income || +r.expenses || +r.profit).map(r => [r.day, +r.income, +r.expenses, +r.profit]),
        foot: ['Total del periodo', sm.income_total, sm.expenses_total, sm.net_profit], note: 'Ganancia neta = ventas − costo vendido + otros ingresos − gastos operativos. Se descuenta el costo de las ventas reembolsadas (ya pagado al proveedor). Las compras de inventario no se restan dos veces.' }
    }
    if (kind === 'expenses') {
      const e = await exps(), cat = new Map<string, number>(); e.forEach(x => cat.set(x.category, (cat.get(x.category) ?? 0) + +x.amount))
      return { cols: [{ h: 'Fecha', k: 'text' }, { h: 'Concepto', k: 'text' }, { h: 'Categoría', k: 'text' }, { h: 'Responsable', k: 'text' }, { h: 'Importe', k: 'money' }],
        rows: e.map(x => [x.expense_date, x.concept, EXP[x.category] ?? x.category, who(x.responsible_id), +x.amount]),
        foot: ['', '', '', 'Total', e.reduce((t, x) => t + +x.amount, 0)], note: [...cat].map(([k, v]) => `${EXP[k] ?? k}: ${money(v)}`).join(' · ') }
    }
    if (kind === 'products') {
      const p = ok(await supabase.from('products').select('*').eq('workspace_id', ws.id).order('name')) as any[], { items } = await soldItems(), g = byProduct(items)
      const sold = (x: any) => g.find(y => y.id === x.id)
      return { cols: [{ h: 'Producto', k: 'text' }, { h: 'Categoría', k: 'text' }, { h: 'Costo', k: 'money' }, { h: 'Precio', k: 'money' }, { h: 'Margen', k: 'pct' }, { h: 'Stock', k: 'int' }, { h: 'Vendidas', k: 'int' }, { h: 'Ganancia', k: 'money' }],
        rows: p.map(x => [x.name, catLabel(x.category), +x.cost, +x.sale_price, +x.margin_pct, x.on_demand ? 'Encargo' : x.stock, sold(x)?.u ?? 0, sold(x) ? sold(x)!.rev - sold(x)!.cost : 0]), note: 'Catálogo actual. «Vendidas» y «Ganancia» corresponden al periodo (ventas completadas).' }
    }
    if (kind === 'owners') {
      const sm = ok(await supabase.rpc('dashboard_summary', { p_workspace: ws.id, p_from: a, p_to: b })) as any, s = (await sales()).filter(x => x.status === 'completed'), e = await exps()
      return { cols: [{ h: 'Propietario', k: 'text' }, { h: 'Participación', k: 'pct' }, { h: 'Ganancia correspondiente', k: 'money' }, { h: 'Ventas gestionadas', k: 'money' }, { h: 'Egresos registrados', k: 'money' }],
        rows: mem.map(m => [who(m.user_id), +m.share_percent, (sm.owners as any[]).find(o => o.user_id === m.user_id)?.net_profit ?? 0,
          s.filter(x => x.responsible_id === m.user_id).reduce((t, x) => t + +x.total, 0), e.filter(x => x.responsible_id === m.user_id).reduce((t, x) => t + +x.amount, 0)]),
        foot: ['Total', 100, sm.net_profit, s.reduce((t, x) => t + +x.total, 0), e.reduce((t, x) => t + +x.amount, 0)], note: 'La ganancia se reparte según el porcentaje vigente de cada propietario.' }
    }
    const { items } = await soldItems(), g = byProduct(items).sort((x, y) => (y.rev - y.cost) - (x.rev - x.cost))
    return { cols: [{ h: 'Producto', k: 'text' }, { h: 'Unidades', k: 'int' }, { h: 'Ingresos', k: 'money' }, { h: 'Costo', k: 'money' }, { h: 'Ganancia', k: 'money' }, { h: 'Margen', k: 'pct' }],
      rows: g.map(x => [x.name, x.u, x.rev, x.cost, x.rev - x.cost, x.rev > 0 ? (x.rev - x.cost) / x.rev * 100 : 0]),
      foot: ['Total', g.reduce((t, x) => t + x.u, 0), g.reduce((t, x) => t + x.rev, 0), g.reduce((t, x) => t + x.cost, 0), g.reduce((t, x) => t + x.rev - x.cost, 0), (() => { const r = g.reduce((t, x) => t + x.rev, 0), c = g.reduce((t, x) => t + x.cost, 0); return r > 0 ? (r - c) / r * 100 : 0 })()],
      note: 'Rentabilidad por producto, solo ventas completadas del periodo.' }
  }, [kind, a, b, ws.id])

  useEffect(() => { let live = true; setLoading(true); build().then(r => { if (live) { setRep(r); setErr(''); setLoading(false) } }).catch(e => { if (live) { setErr(e.message); setLoading(false) } }); return () => { live = false } }, [build])

  const base = () => `astro-import-${kind}-${a}_${b}`
  function csv() {
    if (!rep) return
    const lines = [rep.cols.map(c => csvCell(c.h, 'text')).join(','), ...rep.rows.map(r => r.map((v, i) => csvCell(v, rep.cols[i].k)).join(',')), ...(rep.foot ? [rep.foot.map((v, i) => csvCell(v, rep.cols[i].k)).join(',')] : [])]
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const l = document.createElement('a'); l.href = url; l.download = base() + '.csv'; l.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function pdf() {
    if (!rep || busy) return; setBusy(true)
    try {
      const [{ default: JsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]); const m: any = at; const autoTable = (m.default?.default ?? m.default ?? m.autoTable) as typeof at.default
      const doc = new JsPDF({ orientation: rep.cols.length > 6 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' }), W = doc.internal.pageSize.getWidth()
      doc.setFillColor(5, 5, 5); doc.rect(0, 0, W, 24, 'F')
      try { const blob = await (await fetch('/logo.png')).blob(); const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob) }); doc.addImage(url, 'PNG', 8, 3, 24, 18) } catch { /* sin logo */ }
      doc.setTextColor(255); doc.setFontSize(15); doc.text(`ASTRO IMPORT - Reporte de ${title.toLowerCase()}`, 36, 11); doc.setFontSize(9)
      doc.text(`${ws.name} | Periodo: ${a} a ${b} | Generado: ${new Date().toLocaleString('es-PE')}`, 36, 18)
      const num = (i: number) => rep.cols[i].k !== 'text'
      autoTable(doc, { startY: 30, head: [rep.cols.map(c => c.h)], body: rep.rows.map(r => r.map((v, i) => fmt(v, rep.cols[i].k))), foot: rep.foot ? [rep.foot.map((v, i) => fmt(v, rep.cols[i].k))] : undefined,
        headStyles: { fillColor: [139, 53, 245] }, footStyles: { fillColor: [30, 20, 50], textColor: 255 }, styles: { fontSize: 8 }, columnStyles: Object.fromEntries(rep.cols.map((_, i) => [i, { halign: num(i) ? 'right' : 'left' }])) })
      if (rep.note) { const y = (doc as any).lastAutoTable.finalY + 6; doc.setTextColor(90); doc.setFontSize(8); doc.text(doc.splitTextToSize(rep.note, W - 20), 10, y) }
      doc.save(base() + '.pdf')
    } catch (e: any) { setErr('No se pudo generar el PDF: ' + e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold mr-auto">Reportes</h2>
        <button className="btn-ghost" disabled={!rep?.rows.length} onClick={csv}>Exportar CSV</button><button className="btn" disabled={!rep?.rows.length || busy} onClick={pdf}>{busy ? 'Generando…' : 'Exportar PDF'}</button></div>
      <div className="flex flex-wrap gap-2">
        <select className="input !w-auto" value={kind} onChange={e => setKind(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input !w-auto" value={rk} onChange={e => setRk(e.target.value)}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {rk === 'custom' && <><input type="date" className="input !w-auto" value={from} onChange={e => setFrom(e.target.value)} /><input type="date" className="input !w-auto" value={to} onChange={e => setTo(e.target.value)} /></>}
        <span className="text-xs text-astro-gray self-center">{a} → {b}</span></div>
      {err && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]"><thead className="text-astro-gray text-xs"><tr>{rep?.cols.map(c => <th key={c.h} className={`px-3 py-2 font-normal ${c.k === 'text' ? 'text-left' : 'text-right'}`}>{c.h}</th>)}</tr></thead><tbody>
          {loading ? <tr><td className="p-6 text-center text-astro-gray">Cargando…</td></tr> : !rep?.rows.length ? <tr><td colSpan={rep?.cols.length ?? 1} className="p-6 text-center text-astro-gray">Sin datos en este periodo.</td></tr> :
            rep.rows.map((r, i) => <tr key={i} className="border-t border-astro-border">{r.map((v, j) => <td key={j} className={`px-3 py-1.5 ${rep.cols[j].k === 'text' ? '' : 'text-right'}`}>{fmt(v, rep.cols[j].k)}</td>)}</tr>)}
          {!loading && rep?.foot && rep.rows.length > 0 && <tr className="border-t-2 border-astro-violet-500 font-semibold">{rep.foot.map((v, j) => <td key={j} className={`px-3 py-2 ${rep.cols[j].k === 'text' ? '' : 'text-right'}`}>{fmt(v, rep.cols[j].k)}</td>)}</tr>}
        </tbody></table></div>
      {rep?.note && <p className="text-xs text-astro-gray">{rep.note}</p>}
    </div>
  )
}
