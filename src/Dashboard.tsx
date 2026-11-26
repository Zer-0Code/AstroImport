import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, chan, money, rangeFor, iso } from './lib'
import { Icon } from './icons'

type Owner = { user_id: string; name: string | null; share_percent: number; net_profit: number }
type Sum = { revenue: number; gross_profit: number; income_total: number; expenses_total: number; net_profit: number; cash_flow: number; other_income: number; operating_expenses: number; refund_losses: number
  pending_profit: number; pending_sales: number; sales_count: number; units_sold: number; pending_tasks: number; low_stock: number; owners: Owner[] }
type Pt = { day: string; income: number; expenses: number; profit: number }
type Log = { id: number; table_name: string; action: string; created_at: string; actor_id: string | null }

const RANGES = [['today', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['month', 'Este mes'], ['prev', 'Mes anterior'], ['custom', 'Personalizado']]
const TABLES: Record<string, string> = { products: 'producto', suppliers: 'proveedor', supplier_quotes: 'cotización', competitor_prices: 'precio de competidor', sales: 'venta', expenses: 'egreso', income: 'ingreso', tasks: 'tarea', message_templates: 'plantilla', split_change_requests: 'distribución' }
const ACTIONS: Record<string, string> = { insert: 'creó', update: 'editó', delete: 'eliminó' }
const compact = (v: number) => new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

function Kpi({ label, value, sub, icon, bad }: { label: string; value: string; sub?: string; icon: string; bad?: boolean }) {
  return (
    <div className="card card-hover flex gap-3 items-start"><span className="icon-chip shrink-0"><Icon n={icon} className="w-[18px] h-[18px]" /></span>
      <div className="min-w-0"><p className="text-xs text-astro-gray">{label}</p><p className={`text-xl font-semibold tracking-tight ${bad ? 'text-red-400' : ''}`}>{value}</p>{sub && <p className="text-[11px] text-astro-gray mt-0.5 leading-snug">{sub}</p>}</div></div>
  )
}

function Chart({ data, mode }: { data: Pt[]; mode: 'flow' | 'profit' }) {
  const W = 640, H = 230, L = 44, R = 12, T = 12, B = 22
  const vals = mode === 'flow' ? data.flatMap(d => [d.income, d.expenses]) : data.map(d => d.profit)
  const max = Math.max(1, ...vals), min = mode === 'profit' ? Math.min(0, ...vals) : 0
  const y = (v: number) => H - B - ((v - min) / (max - min || 1)) * (H - T - B)
  const step = (W - L - R) / Math.max(1, data.length)
  if (!data.length || vals.every(v => v === 0)) return <p className="text-sm text-astro-gray py-16 text-center">Sin movimientos en este periodo.</p>
  const id = 'g' + mode, pts = data.map((d, i) => [L + i * step + step / 2, y(d.profit)])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <defs>
        <linearGradient id={id + 'a'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C9A2FF" /><stop offset="1" stopColor="#6D1FF2" /></linearGradient>
        <linearGradient id={id + 'b'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#AAAAB8" /><stop offset="1" stopColor="#4A4A58" /></linearGradient>
        <linearGradient id={id + 'c'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#AF70FD" stopOpacity=".5" /><stop offset="1" stopColor="#AF70FD" stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2, 3].map(i => { const v = min + (max - min) * i / 3; return <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,.07)" strokeDasharray="3 4" /><text x={L - 6} y={y(v) + 3} fontSize="10" fill="#92929E" textAnchor="end">{compact(v)}</text></g> })}
      {mode === 'flow' ? data.map((d, i) => { const x = L + i * step + step * 0.12, w = Math.max(2, step * 0.36)
        return <g key={d.day}><title>{`${d.day}: ingresos ${money(d.income)} · egresos ${money(d.expenses)}`}</title>
          <rect x={x} width={w} y={y(d.income)} height={Math.max(0, y(0) - y(d.income))} fill={`url(#${id}a)`} rx="3" />
          <rect x={x + w + 1.5} width={w} y={y(d.expenses)} height={Math.max(0, y(0) - y(d.expenses))} fill={`url(#${id}b)`} rx="3" /></g> }) :
        <><path d={`M${pts[0][0]},${y(0)} ${pts.map(p => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${y(0)} Z`} fill={`url(#${id}c)`} />
          <polyline fill="none" stroke="#C9A2FF" strokeWidth="2.5" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(175,112,253,.9))' }} points={pts.map(p => p.join(',')).join(' ')} />
          {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff"><title>{`${data[i].day}: ${money(data[i].profit)}`}</title></circle>)}</>}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,.2)" />
      <text x={L} y={H - 6} fontSize="10" fill="#92929E">{data[0].day.slice(5)}</text><text x={W - R} y={H - 6} fontSize="10" fill="#92929E" textAnchor="end">{data[data.length - 1].day.slice(5)}</text>
    </svg>
  )
}

export default function Dashboard({ ws }: { ws: { id: string; name: string } }) {
  const [rk, setRk] = useState('30d'), [from, setFrom] = useState(iso(new Date())), [to, setTo] = useState(iso(new Date()))
  const [sum, setSum] = useState<Sum | null>(null), [series, setSeries] = useState<Pt[]>([]), [logs, setLogs] = useState<Log[]>([])
  const [names, setNames] = useState<Record<string, string>>({}), [members, setMembers] = useState(1)
  const [err, setErr] = useState(''), [loading, setLoading] = useState(true), [invite, setInvite] = useState(''), [inviteMsg, setInviteMsg] = useState('')
  const [a, b] = useMemo(() => rangeFor(rk, from, to), [rk, from, to])

  const load = useCallback(async () => {
    if (a > b) { setErr('La fecha inicial no puede ser posterior a la final.'); setLoading(false); return }
    const [s, ser, lg, mem] = await Promise.all([
      supabase.rpc('dashboard_summary', { p_workspace: ws.id, p_from: a, p_to: b }), supabase.rpc('dashboard_series', { p_workspace: ws.id, p_from: a, p_to: b }),
      supabase.from('audit_logs').select('id,table_name,action,created_at,actor_id').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(8),
      supabase.from('workspace_members').select('user_id,profiles(full_name,email)').eq('workspace_id', ws.id)])
    const bad = s.error || ser.error || lg.error || mem.error
    if (bad) { setErr('No se pudo conectar con la base de datos: ' + bad.message); setLoading(false); return }
    setErr(''); setSum(s.data as Sum)
    setSeries((ser.data as any[]).map(r => ({ day: r.day, income: +r.income, expenses: +r.expenses, profit: +r.profit }))); setLogs(lg.data as Log[])
    const m = (mem.data ?? []) as any[]; setMembers(m.length); setNames(Object.fromEntries(m.map(x => [x.user_id, x.profiles?.full_name || x.profiles?.email || 'Propietario']))); setLoading(false)
  }, [ws.id, a, b])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    let t: number; const refresh = () => { clearTimeout(t); t = window.setTimeout(load, 400) }
    const ch = chan('dash-' + ws.id)
    for (const table of ['sales', 'sale_items', 'expenses', 'income', 'tasks', 'products', 'workspace_members']) ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${ws.id}` }, refresh)
    ch.subscribe(); return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [ws.id, load])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault(); const { error } = await supabase.rpc('invite_owner', { p_email: invite })
    setInviteMsg(error ? error.message : 'Invitación registrada. Tu socio debe crear su cuenta con ese correo y confirmarlo.'); if (!error) setInvite('')
  }
  const loss = (sum?.net_profit ?? 0) < 0
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2"><div className="mr-auto"><h2 className="text-xl font-bold tracking-tight">Panel principal</h2><p className="text-xs text-astro-gray">{a} → {b}</p></div>
        <select className="input !w-auto" value={rk} onChange={e => setRk(e.target.value)}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {rk === 'custom' && <><input type="date" className="input !w-auto" value={from} onChange={e => setFrom(e.target.value)} /><input type="date" className="input !w-auto" value={to} onChange={e => setTo(e.target.value)} /></>}</div>
      {err && <div className="card border-red-500/50 text-red-300 text-sm">{err} <button className="underline ml-2" onClick={load}>Reintentar</button></div>}
      {loading && !sum ? <p className="text-astro-gray">Cargando…</p> : sum && <>
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="hero lg:col-span-2 p-5 sm:p-7 relative overflow-hidden">
            <p className="flex items-center gap-2 text-white/85 text-sm"><Icon n="spark" className="w-4 h-4" />Ganancia neta del periodo</p>
            <p className={`text-4xl sm:text-6xl font-extrabold tracking-tight mt-2 ${loss ? 'text-red-200' : ''}`}>{money(sum.net_profit)}</p>
            <p className="text-white/75 text-sm mt-2 max-w-xl">Trabajamos bajo encargo: lo único que ganamos y repartimos es la ganancia neta.</p>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 text-xs">{([['Ganancia bruta', sum.gross_profit, ''], ['Otros ingresos', sum.other_income, '+'], ['Gastos operativos', sum.operating_expenses, '−'], ['Reembolsos (costo perdido)', sum.refund_losses, '−']] as [string, number, string][]).map(([k, v, sg]) =>
              <div key={k} className="rounded-xl bg-black/25 border border-white/15 px-3 py-2"><dt className="text-white/70">{k}</dt><dd className="font-semibold text-sm">{sg} {money(v)}</dd></div>)}</dl>
          </section>
          <section className="card"><h3 className="font-medium mb-3">Ganancia por propietario</h3>
            <ul className="space-y-3">{sum.owners.map(o => (<li key={o.user_id}><div className="flex justify-between text-sm"><span>{names[o.user_id] ?? o.name ?? 'Propietario'}</span><b>{money(o.net_profit)}</b></div>
              <div className="h-1.5 rounded-full bg-white/10 mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-astro-gradient" style={{ width: `${o.share_percent}%` }} /></div><p className="text-[11px] text-astro-gray mt-0.5">{o.share_percent}% de la ganancia neta</p></li>))}</ul>
            {members < 2 && <form onSubmit={sendInvite} className="mt-4 space-y-2"><p className="text-xs text-astro-gray">Invita al segundo propietario:</p>
              <input className="input" type="email" placeholder="correo@socio.com" value={invite} onChange={e => setInvite(e.target.value)} required /><button className="btn w-full">Invitar</button>{inviteMsg && <p className="text-xs text-astro-violet-300">{inviteMsg}</p>}</form>}
          </section>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon="dollar" label="Ingresos totales" value={money(sum.income_total)} sub="Ventas completadas + otros" />
          <Kpi icon="down" label="Egresos totales" value={money(sum.expenses_total)} sub="Incluye pagos a proveedores" />
          <Kpi icon="wallet" label="Flujo de caja" value={money(sum.cash_flow)} bad={sum.cash_flow < 0} />
          <Kpi icon="clock" label="Ganancia por cobrar" value={money(sum.pending_profit)} sub={`${sum.pending_sales} venta(s) pendiente(s)`} />
          <Kpi icon="receipt" label="Ventas realizadas" value={String(sum.sales_count)} />
          <Kpi icon="bag" label="Productos vendidos" value={String(sum.units_sold)} />
          <Kpi icon="check" label="Tareas pendientes" value={String(sum.pending_tasks)} />
          <Kpi icon="alert" label="Stock bajo" value={String(sum.low_stock)} sub="Solo productos con stock propio" />
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="card lg:col-span-2"><h3 className="font-medium mb-2">Ingresos y egresos <span className="ml-2 text-xs text-astro-gray"><span className="text-astro-violet-400">●</span> ingresos <span className="ml-2">●</span> egresos</span></h3><Chart data={series} mode="flow" /></section>
          <section className="card"><h3 className="font-medium mb-3">Actividad reciente</h3>
            {logs.length === 0 ? <p className="text-sm text-astro-gray">Aún no hay actividad.</p> : <ul className="space-y-2.5 text-sm">{logs.map(l => (
              <li key={l.id} className="flex gap-2"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-astro-violet-400 shrink-0" /><div><span className="text-astro-violet-300">{(l.actor_id && names[l.actor_id]) || 'Alguien'}</span> {ACTIONS[l.action] ?? l.action} {TABLES[l.table_name] ?? l.table_name}
                <span className="block text-xs text-astro-gray">{new Date(l.created_at).toLocaleString('es-PE')}</span></div></li>))}</ul>}</section>
        </div>
        <section className="card"><h3 className="font-medium mb-2">Rentabilidad diaria (ganancia neta)</h3><Chart data={series} mode="profit" /></section>
      </>}
    </div>
  )
}
