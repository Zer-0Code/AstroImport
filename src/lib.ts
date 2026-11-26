import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
export const chan = (n: string) => supabase.channel(`${n}-${Math.random().toString(36).slice(2, 8)}`)
export const money = (n: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n || 0)
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function rangeFor(k: string, from: string, to: string): [string, string] {
  const t = new Date(), ago = (n: number) => { const x = new Date(t); x.setDate(x.getDate() - n); return x }
  switch (k) {
    case 'today': return [iso(t), iso(t)]
    case '7d': return [iso(ago(6)), iso(t)]
    case '30d': return [iso(ago(29)), iso(t)]
    case 'month': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)]
    case 'prev': return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))]
    default: return [from, to]
  }
}
export const CATEGORIES: [string, string][] = [['inteligencia_artificial','Inteligencia Artificial'],['streaming','Streaming'],['diseno_edicion','Diseño y edición'],['productividad','Productividad'],['ingenieria','Ingeniería'],['licencias_software','Licencias de software'],['otros','Otros']]
export const catLabel = (v: string) => CATEGORIES.find(c => c[0] === v)?.[1] ?? v
