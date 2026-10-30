import { useMemo } from 'react'
import { encode } from 'uqr'

/** A crisp, printable QR code drawn as one SVG path. Always dark on white so phones can scan it in any theme. */
export function QrCode({ value, size = 120, className, label }: { value: string; size?: number; className?: string; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)))
    return { path: d, n: qr.size }
  }, [value])
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className={className}>
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#111827" />
    </svg>
  )
}
