import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// El modal se dibuja en <body> (portal) para que ningún contenedor con animación o filtro lo recorte o lo desplace.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key) }
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 backdrop-blur-sm">
      <div className="min-h-full grid place-items-center p-3 sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="card page w-full max-w-2xl" role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex items-center mb-3"><h3 className="font-semibold">{title}</h3><button className="ml-auto text-astro-gray hover:text-white text-2xl leading-none" onClick={onClose} aria-label="Cerrar">×</button></div>
          {children}
        </div>
      </div>
    </div>, document.body)
}
export const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) =>
  <label className={`block text-sm ${className}`}><span className="text-astro-gray">{label}</span>{children}</label>
