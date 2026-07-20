import { useEffect, useState } from 'react'
import { fetchSignal, type SignalPoint } from '../lib/signalFeed'
import { Sparkline } from './Sparkline'

// The board card's headline chart, drawn from the keeper's REAL signal feed for one odd (the same
// demargined % the market settles on) instead of a seeded random walk. Polls /signal; until real
// points arrive (or if the keeper is unreachable) it falls back to the decorative Sparkline so a
// card is never blank. Framed on the odd's level (prob ± 18) to match the fallback's look.
export function LiveSparkline({
  fixtureId,
  oddKey,
  marketParams,
  prob,
  seed,
  height,
}: {
  fixtureId: number
  oddKey: number
  marketParams: number
  prob: number
  seed: string
  height?: number
}) {
  const [pts, setPts] = useState<SignalPoint[]>([])
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      const p = await fetchSignal(fixtureId, oddKey, marketParams)
      if (!cancelled) setPts(p)
    }
    pull()
    const id = setInterval(pull, 8000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [fixtureId, oddKey, marketParams])

  if (pts.length < 2) return <Sparkline seed={seed} prob={prob} height={height} />

  // Recent window only - the full buffer crammed into a thumbnail reads as noise; the last ~40
  // points show the current movement cleanly while staying the real feed.
  const vals = pts.slice(-40).map((p) => p.v)
  const mn = Math.max(0, prob - 18)
  const mx = Math.min(100, prob + 18)
  const w = 200
  const H = height || 56
  const pad = 3
  const x = (i: number) => pad + (i / (vals.length - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (1 - (Math.max(mn, Math.min(mx, v)) - mn) / (mx - mn || 1)) * (H - 2 * pad)
  const sup = Math.max(mn + 1, prob - 6)
  const res = Math.min(mx - 1, prob + 7)
  const poly = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none">
      <line x1={0} y1={y(res)} x2={w} y2={y(res)} stroke="#f3596b" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={y(sup)} x2={w} y2={y(sup)} stroke="#2fc079" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
      <polyline points={poly} fill="none" stroke="#5BC8D6" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.4} fill="#F2B43D" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
