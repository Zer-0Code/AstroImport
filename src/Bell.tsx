import { useCallback, useEffect, useState } from 'react'
import { supabase, iso } from './lib'

type Item = { label: string; n: number; view: string }
export default function Bell({ wsId, uid, go, view }: { wsId: string; uid: string; go: (v: string) => void; view: string }) {
  const [items, setItems] = useState<Item[]>([]), [open, setOpen] = useState(false), [fail, setFail] = useState(false)
  const load = useCallback(async () => {
    const today = iso(new Date())
    const [p, q, t, r] = await Promise.all([
      supabase.from('products').select('stock,min_stock,on_demand').eq('workspace_id', wsId).eq('status', 'active'),
      supabase.from('supplier_quotes').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).lt('recheck_after', today),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).neq('status', 'completed').lt('due_date', today),
      supabase.from('reminders').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('user_id', uid).is('done_at', null).lte('remind_at', new Date().toISOString())])
    if (p.error || q.error || t.error || r.error) { setFail(true); return }
    setFail(false); const prods = ((p.data ?? []) as { stock: number; min_stock: number; on_demand: boolean }[]).filter(x => !x.on_demand)
    setItems([{ label: 'Productos sin stock', n: prods.filter(x => x.stock === 0).length, view: 'products' },
      { label: 'Productos con stock bajo', n: prods.filter(x => x.stock > 0 && x.stock <= x.min_stock).length, view: 'products' },
      { label: 'Cotizaciones por verificar de nuevo', n: q.count ?? 0, view: 'suppliers' }, { label: 'Tareas vencidas', n: t.count ?? 0, view: 'tasks' },
      { label: 'Recordatorios para ti', n: r.count ?? 0, view: 'tasks' }].filter(i => i.n > 0))
  }, [wsId, uid])
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [load, view])
  const total = items.reduce((a, i) => a + i.n, 0)
  return (
    <div className="relative">
      <button className="btn-ghost relative" onClick={() => { setOpen(!open); load() }} aria-label="Notificaciones">🔔{total > 0 && <span className="absolute -top-1 -right-1 bg-astro-violet-600 text-[10px] rounded-full px-1.5">{total}</span>}</button>
      {open && <div className="absolute right-0 mt-2 w-72 card z-20 space-y-1 text-sm">
        {fail ? <p className="text-red-300">No se pudieron cargar las alertas.</p> : items.length === 0 ? <p className="text-astro-gray">Sin alertas pendientes.</p> :
          items.map(i => <button key={i.label} className="flex w-full justify-between hover:text-astro-violet-300" onClick={() => { go(i.view); setOpen(false) }}><span>{i.label}</span><b>{i.n}</b></button>)}</div>}
    </div>
  )
}
