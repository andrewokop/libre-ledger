import { useEffect, useState } from 'react'
import { money } from './types'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

export function Amount({ value, signed = false }: { value: number; signed?: boolean }) {
  return <>{signed && value > 0 ? '+' : ''}{money(value)}<span className="currency-unit"> ₽</span></>
}

export function BrandMark() {
  return <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true"><path d="M7 6v16a6 6 0 0 0 6 6h14M14 6v12a3 3 0 0 0 3 3h10M21 6v8h6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
