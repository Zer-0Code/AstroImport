import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, money, rangeFor, iso } from './lib'

type Owner = { user_id: string; name: string | null; share_percent: number; net_profit: number }
type Sum = { revenue: number; gross_profit: number; income_total: number; expenses_total: number; net_profit: number; cash_flow: number
  sales_count: number; units_sold: number; pending_tasks: number; low_stock: number; owners: Owner[] }
type Pt = { day: string; income: number; expenses: number; profit: number }
type Log = { id: number; table_name: string; action: string; created_at: string; actor_id: string | null }

const RANGES = [['today', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['month', 'Este mes'], ['prev', 'Mes anterior'], ['custom', 'Personalizado']]
const TABLES: Record<string, string> = { products: 'producto', suppliers: 'proveedor', supplier_quotes: 'cotización', competitor_prices: 'precio de competidor',
  sales: 'venta', expenses: 'egreso', income: 'ingreso', tasks: 'tarea', message_templates: 'plantilla', split_change_requests: 'distribución' }
const ACTIONS: Record<string, string> = { insert: 'creó', update: 'editó', delete: 'eliminó' }

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card">
      <p className="text-xs text-astro-gray">{label}</p>
      <p className={`text-xl sm:text-2xl font-semibold mt-1 ${tone === 'bad' ? 'text-red-400' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-astro-gray mt-1">{sub}</p>}
    </div>
  )
}

function Chart({ data, mode }: { data: Pt[]; mode: 'flow' | 'profit' }) {
  const W = 600, H = 200, P = 24
  const vals = mode === 'flow' ? data.flatMap(d => [d.income, d.expenses]) : data.map(d => d.profit)
  const max = Math.max(1, ...vals), min = mode === 'profit' ? Math.min(0, ...vals) : 0
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P)
  const step = (W - 2 * P) / Math.max(1, data.length)
  if (!data.length || vals.every(v => v === 0)) return <p className="text-sm text-astro-gray py-16 text-center">Sin movimientos en este periodo.</p>
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#2A2140" />
      {mode === 'flow' ? data.map((d, i) => {
        const x = P + i * step, w = Math.max(2, step * 0.38)
        return <g key={d.day}><title>{`${d.day}: ingresos ${money(d.income)} · egresos ${money(d.expenses)}`}</title>
          <rect x={x} width={w} y={y(d.income)} height={y(0) - y(d.income)} fill="#9050FF" rx="2" />
          <rect x={x + w + 1} width={w} y={y(d.expenses)} height={y(0) - y(d.expenses)} fill="#92929E" rx="2" /></g>
      }) : <polyline fill="none" stroke="#AF70FD" strokeWidth="2.5" strokeLinejoin="round"
          points={data.map((d, i) => `${P + i * step + step / 2},${y(d.profit)}`).join(' ')} />}
      <text x={P} y={12} fontSize="10" fill="#92929E">{money(max)}</text>
    </svg>
  )
}

export default function Dashboard({ ws }: { ws: { id: string; name: string } }) {
  const [rk, setRk] = useState('30d'), [from, setFrom] = useState(iso(new Date())), [to, setTo] = useState(iso(new Date()))
  const [sum, setSum] = useState<Sum | null>(null), [series, setSeries] = useState<Pt[]>([]), [logs, setLogs] = useState<Log[]>([])
  const [names, setNames] = useState<Record<string, string>>({}), [members, setMembers] = useState(1)
  const [err, setErr] = useState(''), [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState(''), [inviteMsg, setInviteMsg] = useState('')
  const [a, b] = useMemo(() => rangeFor(rk, from, to), [rk, from, to])

  const load = useCallback(async () => {
    if (a > b) { setErr('La fecha inicial no puede ser posterior a la final.'); return }
    const [s, ser, lg, mem] = await Promise.all([
      supabase.rpc('dashboard_summary', { p_workspace: ws.id, p_from: a, p_to: b }),
      supabase.rpc('dashboard_series', { p_workspace: ws.id, p_from: a, p_to: b }),
      supabase.from('audit_logs').select('id,table_name,action,created_at,actor_id').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(8),
      supabase.from('workspace_members').select('user_id,profiles(full_name,email)').eq('workspace_id', ws.id)])
    const bad = s.error || ser.error || lg.error
    if (bad) { setErr('No se pudo conectar con la base de datos: ' + bad.message); setLoading(false); return }
    setErr(''); setSum(s.data as Sum)
    setSeries((ser.data as any[]).map(r => ({ day: r.day, income: +r.income, expenses: +r.expenses, profit: +r.profit })))
    setLogs(lg.data as Log[])
    const m = (mem.data ?? []) as any[]
    setMembers(m.length); setNames(Object.fromEntries(m.map(x => [x.user_id, x.profiles?.full_name || x.profiles?.email || 'Propietario'])))
    setLoading(false)
  }, [ws.id, a, b])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    let t: number
    const refresh = () => { clearTimeout(t); t = window.setTimeout(load, 400) }
    const ch = supabase.channel('dash-' + ws.id)
    for (const table of ['sales', 'sale_items', 'expenses', 'income', 'tasks', 'products', 'workspace_members'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${ws.id}` }, refresh)
    ch.subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [ws.id, load])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('invite_owner', { p_email: invite })
    setInviteMsg(error ? error.message : 'Invitación registrada. Tu socio debe crear su cuenta con ese correo y confirmarlo.'); if (!error) setInvite('')
  }

  const loss = (sum?.net_profit ?? 0) < 0
  return (
    <div className="space-y-4">
      <>
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="text-lg font-semibold mr-auto">Panel principal</h2>
          <select className="input !w-auto" value={rk} onChange={e => setRk(e.target.value)}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {rk === 'custom' && <><input type="date" className="input !w-auto" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" className="input !w-auto" value={to} onChange={e => setTo(e.target.value)} /></>}
        </div>
        {err && <div className="card border-red-500/50 text-red-300 text-sm">{err} <button className="underline ml-2" onClick={load}>Reintentar</button></div>}
        {loading && !sum ? <p className="text-astro-gray">Cargando…</p> : sum && <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Ingresos totales" value={money(sum.income_total)} sub="Ventas completadas + otros ingresos" />
            <Kpi label="Egresos totales" value={money(sum.expenses_total)} sub="Incluye compras de inventario" />
            <Kpi label="Ganancia neta" value={money(sum.net_profit)} tone={loss ? 'bad' : 'good'} sub="Ventas − costo − gastos operativos" />
            <Kpi label="Flujo de caja" value={money(sum.cash_flow)} tone={sum.cash_flow < 0 ? 'bad' : 'good'} />
            <Kpi label="Ventas realizadas" value={String(sum.sales_count)} />
            <Kpi label="Productos vendidos" value={String(sum.units_sold)} />
            <Kpi label="Poco stock" value={String(sum.low_stock)} sub="Productos activos en o bajo el mínimo" />
            <Kpi label="Tareas pendientes" value={String(sum.pending_tasks)} />
          </div>
          <div className="grid lg:grid-cols-3 gap-3">
            <section className="card lg:col-span-2"><h3 className="font-medium mb-2">Ingresos y egresos <span className="text-xs text-astro-gray">· <span className="text-astro-violet-500">■</span> ingresos <span>■</span> egresos</span></h3><Chart data={series} mode="flow" /></section>
            <section className="card"><h3 className="font-medium mb-2">Ganancia por propietario</h3>
              <ul className="space-y-2">{sum.owners.map(o => (
                <li key={o.user_id} className="flex justify-between text-sm"><span>{names[o.user_id] ?? o.name ?? 'Propietario'} <span className="text-astro-gray">({o.share_percent}%)</span></span><b>{money(o.net_profit)}</b></li>))}</ul>
              {members < 2 && <form onSubmit={sendInvite} className="mt-4 space-y-2"><p className="text-xs text-astro-gray">Invita al segundo propietario:</p>
                <input className="input" type="email" placeholder="correo@socio.com" value={invite} onChange={e => setInvite(e.target.value)} required />
                <button className="btn w-full">Invitar</button>{inviteMsg && <p className="text-xs text-astro-violet-300">{inviteMsg}</p>}</form>}
            </section>
          </div>
          <div className="grid lg:grid-cols-3 gap-3">
            <section className="card lg:col-span-2"><h3 className="font-medium mb-2">Rentabilidad diaria</h3><Chart data={series} mode="profit" /></section>
            <section className="card"><h3 className="font-medium mb-2">Actividad reciente</h3>
              {logs.length === 0 ? <p className="text-sm text-astro-gray">Aún no hay actividad.</p> :
                <ul className="space-y-2 text-sm">{logs.map(l => (
                  <li key={l.id}><span className="text-astro-violet-300">{(l.actor_id && names[l.actor_id]) || 'Alguien'}</span> {ACTIONS[l.action] ?? l.action} {TABLES[l.table_name] ?? l.table_name}
                    <span className="block text-xs text-astro-gray">{new Date(l.created_at).toLocaleString('es-PE')}</span></li>))}</ul>}
            </section>
          </div>
        </>}
      </>
    </div>
  )
}
