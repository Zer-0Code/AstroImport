import type { ReactNode } from 'react'
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-3" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card page w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center mb-3"><h3 className="font-semibold">{title}</h3><button className="ml-auto text-astro-gray text-xl leading-none" onClick={onClose} aria-label="Cerrar">×</button></div>
        {children}
      </div>
    </div>
  )
}
export const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) =>
  <label className={`block text-sm ${className}`}><span className="text-astro-gray">{label}</span>{children}</label>
