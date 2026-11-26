import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, money, iso, CATEGORIES, catLabel } from './lib'

type P = { id: string; name: string; category: string; supplier_id: string | null; cost: number; sale_price: number; duration: string | null; warranty: string | null }
type C = { id: string; product_id: string | null; product_name: string; competitor_name: string; price: number; observed_on: string; source_url: string | null }
type Q = { supplier_id: string; product_name: string; price: number; availability: string; quoted_at: string; recheck_after: string | null }
type Mem = { user_id: string; share_percent: number; profiles: { full_name: string | null; email: string | null } | null }
const AV: Record<string, string> = { available: 'Disponible', limited: 'Limitado', unavailable: 'Agotado', unknown: 'Sin verificar' }
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const up = (x: number) => Math.ceil(x * 10 - 1e-9) / 10                       // redondeo hacia arriba a 10 céntimos: nunca baja del margen buscado
const pct = (x: number) => `${x.toFixed(1)}%`
const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5)
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

export default function Calculator({ ws, uid }: { ws: { id: string }; uid: string }) {
  const [prods, setProds] = useState<P[]>([]), [sups, setSups] = useState<{ id: string; name: string }[]>([]), [comps, setComps] = useState<C[]>([])
  const [quotes, setQuotes] = useState<Q[]>([]), [mem, setMem] = useState<Mem[]>([]), [hist, setHist] = useState<{ new_price: number; new_cost: number; changed_at: string }[]>([])
  const [pid, setPid] = useState(''), [name, setName] = useState(''), [category, setCategory] = useState('otros'), [supplier, setSupplier] = useState('')
  const [cost, setCost] = useState('0'), [extra, setExtra] = useState('0'), [comm, setComm] = useState('0'), [price, setPrice] = useState('0')
  const [target, setTarget] = useState('30'), [risk, setRisk] = useState('0'), [months, setMonths] = useState(''), [share1, setShare1] = useState('50')
  const [mMin, setMMin] = useState('10'), [mRot, setMRot] = useState('20'), [mEq, setMEq] = useState('30'), [mPrem, setMPrem] = useState('40')
  const [cn, setCn] = useState(''), [cp, setCp] = useState(''), [cu, setCu] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [p, s, c, q, m] = await Promise.all([
      supabase.from('products').select('id,name,category,supplier_id,cost,sale_price,duration,warranty').eq('workspace_id', ws.id).order('name'),
      supabase.from('suppliers').select('id,name').eq('workspace_id', ws.id),
      supabase.from('competitor_prices').select('*').eq('workspace_id', ws.id).order('observed_on', { ascending: false }),
      supabase.from('supplier_quotes').select('supplier_id,product_name,price,availability,quoted_at,recheck_after').eq('workspace_id', ws.id).order('quoted_at', { ascending: false }),
      supabase.from('workspace_members').select('user_id,share_percent,profiles(full_name,email)').eq('workspace_id', ws.id).order('joined_at')])
    const bad = p.error || s.error || c.error || q.error || m.error
    if (bad) { setErr('No se pudo cargar: ' + bad.message); return }
    setProds(p.data as P[]); setSups(s.data as any[]); setComps(c.data as C[]); setQuotes(q.data as Q[])
    const mm = m.data as any as Mem[]; setMem(mm); if (mm[0] && mm.length === 2) setShare1(String(mm[0].share_percent))
  }, [ws.id])
  useEffect(() => { load() }, [load])

  function pick(id: string) {
    setPid(id); setMsg(''); setHist([])
    const p = prods.find(x => x.id === id); if (!p) return
    setName(p.name); setCategory(p.category); setSupplier(p.supplier_id ?? ''); setCost(String(p.cost)); setPrice(String(p.sale_price))
    const mo = /(\d+(?:[.,]\d+)?)\s*(mes|meses|month)/i.exec(p.duration ?? ''); setMonths(mo ? mo[1] : '')
    supabase.from('product_price_history').select('new_price,new_cost,changed_at').eq('product_id', id).order('changed_at', { ascending: false }).limit(5).then(r => setHist((r.data ?? []) as any))
  }
  const prod = prods.find(p => p.id === pid)

  // ---- cálculos ----
  const base = num(cost) + num(extra), c = num(comm) / 100, r = num(risk) / 100, pr = num(price)
  const totalCost = base + pr * c, gross = pr - totalCost
  const margin = pr > 0 ? (gross / pr) * 100 : 0, markup = totalCost > 0 ? (gross / totalCost) * 100 : 0
  const net = gross - r * pr
  const priceFor = (m: number, risky: boolean) => { const d = 1 - m / 100 - c - (risky ? r : 0); return d > 0 ? up(base / d) : NaN }
  const tgtPrice = priceFor(num(target), false)
  const netMargin = (p: number) => p > 0 ? ((p - base - p * c - p * r) / p) * 100 : 0
  const s1 = Math.min(100, Math.max(0, num(share1))), s2 = 100 - s1
  const nm = (i: number) => mem[i]?.profiles?.full_name || mem[i]?.profiles?.email || `Propietario ${i + 1}`

  // ---- mercado ----
  const key = name.trim().toLowerCase()
  const myComps = comps.filter(x => (pid && x.product_id === pid) || (key && x.product_name.trim().toLowerCase() === key))
  const fresh = myComps.filter(x => daysAgo(x.observed_on) <= 30)
  const cmin = fresh.length ? Math.min(...fresh.map(x => x.price)) : NaN, cmax = fresh.length ? Math.max(...fresh.map(x => x.price)) : NaN
  const cmed = fresh.length ? median(fresh.map(x => x.price)) : NaN
  const minP = priceFor(num(mMin), true), rotP = priceFor(num(mRot), true), eqP = priceFor(num(mEq), true), premP = priceFor(num(mPrem), true)
  const compP = fresh.length ? Math.max(up(cmed), isNaN(minP) ? 0 : minP) : eqP
  const myQuote = quotes.find(q => key && q.product_name.trim().toLowerCase() === key)
  const pos = (p: number) => !fresh.length || isNaN(p) ? '' : p < cmin ? 'por debajo del mínimo observado' : p > cmax ? 'por encima del máximo observado' : 'dentro del rango observado'
  const impossible = [minP, rotP, eqP, premP].some(isNaN)

  async function addComp(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    const p = num(cp); if (!name.trim()) return setErr('Indica primero el producto.'); if (!cn.trim() || !(p > 0)) return setErr('Indica competidor y un precio mayor a 0.')
    const { error } = await supabase.from('competitor_prices').insert({ workspace_id: ws.id, created_by: uid, product_id: pid || null, product_name: name.trim(), competitor_name: cn.trim(), price: p, source_url: cu || null, observed_on: iso(new Date()) })
    if (error) return setErr(error.message); setCn(''); setCp(''); setCu(''); load()
  }
  async function delComp(id: string) { const { error } = await supabase.from('competitor_prices').delete().eq('id', id); if (error) setErr(error.message); else load() }
  async function saveToProduct() {
    if (!pid) return; setErr(''); setMsg('')
    const { error } = await supabase.from('products').update({ cost: num(cost), sale_price: pr }).eq('id', pid)
    if (error) return setErr(error.message); setMsg('Precio y costo guardados en el producto (queda en su historial).'); load(); pick(pid)
  }

  const Num = ({ l, v, s, suf }: { l: string; v: string; s: (x: string) => void; suf?: string }) =>
    <label className="block text-sm"><span className="text-astro-gray">{l}</span><div className="relative"><input className="input" inputMode="decimal" value={v} onChange={e => s(e.target.value)} />{suf && <span className="absolute right-3 top-2 text-astro-gray text-sm">{suf}</span>}</div></label>
  const Strat = ({ t, p, m, note }: { t: string; p: number; m: string; note?: string }) => (
    <div className="card !bg-astro-surface2"><p className="text-xs text-astro-gray">{t}</p>
      {isNaN(p) ? <p className="text-sm text-red-400 mt-1">No alcanzable</p> : <>
        <p className="text-xl font-semibold">{money(p)}</p><p className="text-xs text-astro-gray">Margen neto {pct(netMargin(p))} · objetivo {m}%</p>
        {pos(p) && <p className="text-xs text-astro-violet-300">{pos(p)}</p>}{note && <p className="text-xs text-amber-400">{note}</p>}
        <button className="text-xs text-astro-violet-300 mt-1" onClick={() => setPrice(String(p))}>Usar este precio</button></>}
    </div>)

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Calculadora y analizador de precios</h2>
      {err && <div className="card border-red-500/50 text-red-300 text-sm">{err}</div>}
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card space-y-3">
          <h3 className="font-medium">Datos</h3>
          <label className="block text-sm"><span className="text-astro-gray">Producto del catálogo (opcional)</span>
            <select className="input" value={pid} onChange={e => pick(e.target.value)}><option value="">Producto manual</option>{prods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm col-span-2"><span className="text-astro-gray">Nombre</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="block text-sm"><span className="text-astro-gray">Categoría</span><select className="input" value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="block text-sm"><span className="text-astro-gray">Proveedor</span><select className="input" value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">—</option>{sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <Num l="Costo de adquisición (S/)" v={cost} s={setCost} /><Num l="Gasto adicional fijo (S/)" v={extra} s={setExtra} />
            <Num l="Comisión de pago" v={comm} s={setComm} suf="%" /><Num l="Riesgo de devolución" v={risk} s={setRisk} suf="%" />
            <Num l="Precio de venta propuesto (S/)" v={price} s={setPrice} /><Num l="Duración (meses)" v={months} s={setMonths} />
            <Num l="Margen objetivo" v={target} s={setTarget} suf="%" /><Num l={`Reparto de ${nm(0)}`} v={share1} s={setShare1} suf="%" />
          </div>
          <p className="text-xs text-astro-gray">Reparto solo para este cálculo. El reparto oficial se cambia con la autorización de ambos propietarios.</p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-medium">Resultado con tu precio ({money(pr)})</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {([['Costo total', money(totalCost)], ['Ganancia bruta', money(gross)], ['Margen sobre venta', pct(margin)], ['Recargo sobre costo', pct(markup)],
              ['Ganancia neta estimada', money(net)], [`Participación de ${nm(0)}`, money(net * s1 / 100)], [`Participación de ${nm(1)}`, money(net * s2 / 100)],
              ...(num(months) > 0 ? [['Precio por mes', money(pr / num(months))], ['Costo por mes', money(totalCost / num(months))]] : [])] as string[][]).map(([k, v]) =>
              <div key={k} className="contents"><dt className="text-astro-gray">{k}</dt><dd className={`text-right font-medium ${k.startsWith('Ganancia') && gross < 0 ? 'text-red-400' : ''}`}>{v}</dd></div>)}
          </dl>
          <p className="text-xs text-astro-gray">Margen = (precio − costo total) ÷ precio. Recargo = (precio − costo total) ÷ costo total. La ganancia neta descuenta la pérdida esperada por devoluciones (riesgo × precio).</p>
          <div className="border-t border-astro-border pt-2 text-sm">Para un margen de {target}%: {isNaN(tgtPrice) ? <span className="text-red-400">no es alcanzable con esa comisión</span> :
            <><b>{money(tgtPrice)}</b> <button className="text-astro-violet-300 ml-1" onClick={() => setPrice(String(tgtPrice))}>usar</button></>}</div>
          {pid && <button className="btn w-full !py-1.5 text-sm" onClick={saveToProduct}>Guardar costo y precio en "{prod?.name}"</button>}
          {msg && <p className="text-sm text-astro-violet-300">{msg}</p>}
        </section>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2"><h3 className="font-medium mr-auto">Analizador comercial</h3>
          {([['Mínimo', mMin, setMMin], ['Rotación', mRot, setMRot], ['Equilibrado', mEq, setMEq], ['Premium', mPrem, setMPrem]] as [string, string, (v: string) => void][]).map(([l, v, s]) =>
            <label key={l} className="text-xs text-astro-gray">{l} %<input className="input !w-16 !py-1" inputMode="decimal" value={v} onChange={e => s(e.target.value)} /></label>)}</div>
        <p className="text-xs text-astro-gray">Los márgenes netos son tus objetivos (editables), no precios de mercado. Incluyen comisión de pago y riesgo de devolución.</p>
        {impossible && <p className="text-sm text-red-400">Algún margen no es alcanzable: margen + comisión + riesgo no puede llegar a 100%.</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Strat t="Precio mínimo recomendado" p={minP} m={mMin} />
          <Strat t="1 · Rotación rápida" p={rotP} m={mRot} />
          <Strat t="2 · Equilibrado" p={eqP} m={mEq} />
          <Strat t="3 · Premium" p={premP} m={mPrem} note={prod && !prod.warranty ? 'Este producto no tiene garantía registrada: el premium necesita valor agregado.' : undefined} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4 text-sm">
          <div className="space-y-1"><h4 className="font-medium">Mercado</h4>
            {!myComps.length ? <p className="text-amber-400">No hay precios de competidores registrados para este producto. No se inventan datos de mercado: las sugerencias salen solo de tus márgenes.</p> :
              <>{!fresh.length && <p className="text-amber-400">Los precios registrados tienen más de 30 días; vuelve a consultarlos.</p>}
                {fresh.length > 0 && <p>Precio competitivo sugerido: <b>{money(compP)}</b> <span className="text-astro-gray">(mediana de {fresh.length} precio(s) de los últimos 30 días: mín {money(cmin)} · máx {money(cmax)})</span>
                  {!isNaN(minP) && up(cmed) < minP && <span className="block text-amber-400">La mediana del mercado queda bajo tu mínimo; se muestra tu mínimo.</span>}</p>}
                <ul className="text-xs text-astro-gray">{myComps.slice(0, 6).map(x => <li key={x.id}>{x.competitor_name}: {money(x.price)} · {x.observed_on} ({daysAgo(x.observed_on)} d){daysAgo(x.observed_on) > 30 ? ' · vencido' : ''}
                  {x.source_url && <> · <a className="underline" href={x.source_url} target="_blank" rel="noreferrer noopener">fuente</a></>} <button className="text-red-400 ml-1" onClick={() => delComp(x.id)}>quitar</button></li>)}</ul></>}
            <form onSubmit={addComp} className="grid grid-cols-6 gap-1.5 pt-1">
              <input className="input col-span-2 !py-1" placeholder="Competidor" value={cn} onChange={e => setCn(e.target.value)} />
              <input className="input col-span-1 !py-1" placeholder="S/" inputMode="decimal" value={cp} onChange={e => setCp(e.target.value)} />
              <input className="input col-span-2 !py-1" placeholder="Enlace (opcional)" value={cu} onChange={e => setCu(e.target.value)} /><button className="btn !py-1 text-xs">Añadir</button></form>
          </div>
          <div className="space-y-1"><h4 className="font-medium">Contexto propio</h4>
            <p>Proveedor: {myQuote ? <>{sups.find(s => s.id === myQuote.supplier_id)?.name} cotizó {money(myQuote.price)} · {AV[myQuote.availability]} · {myQuote.quoted_at}
              {(!myQuote.recheck_after || myQuote.recheck_after < iso(new Date())) && <span className="text-amber-400"> · verificar de nuevo</span>}</> : <span className="text-astro-gray">sin cotizaciones registradas</span>}</p>
            <p>Garantía: {prod?.warranty || <span className="text-astro-gray">no registrada</span>} · Duración: {prod?.duration || <span className="text-astro-gray">no registrada</span>}</p>
            <p>Historial propio: {hist.length ? hist.map(h => `${money(h.new_price)} (${h.changed_at.slice(0, 10)})`).join(' → ') : <span className="text-astro-gray">{pid ? 'sin cambios registrados' : 'elige un producto del catálogo'}</span>}</p>
            <p className="text-xs text-astro-gray">Categoría: {catLabel(category)}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
