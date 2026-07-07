import { rng } from './data'

// Ported verbatim (same math) from the `spark()` template-string function in
// frontend/index.html — deterministic per-seed sparkline with support/resistance
// guide lines, used on board cards and the all-odds rows.
export function Sparkline({ seed, prob, height }: { seed: string; prob: number; height?: number }) {
  const r = rng(seed)
  const N = 24
  const mn = Math.max(0, prob - 18)
  const mx = Math.min(100, prob + 18)
  let p = prob
  const pts: number[] = []
  for (let i = 0; i < N; i++) {
    p = Math.max(mn + 1, Math.min(mx - 1, p + (r() - 0.5) * 3.4))
    pts.push(p)
  }
  const w = 200
  const H = height || 56
  const pad = 3
  const x = (i: number) => pad + (i / (N - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (1 - (v - mn) / (mx - mn)) * (H - 2 * pad)
  const sup = Math.max(mn + 1, prob - 6)
  const res = Math.min(mx - 1, prob + 7)
  const poly = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none">
      <line x1={0} y1={y(res)} x2={w} y2={y(res)} stroke="#f3596b" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={y(sup)} x2={w} y2={y(sup)} stroke="#2fc079" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
      <polyline points={poly} fill="none" stroke="#5BC8D6" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(N - 1)} cy={y(pts[N - 1])} r={2.4} fill="#F2B43D" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
