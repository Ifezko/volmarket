import { useCallback, useEffect, useRef, useState } from 'react'

// Ported verbatim (same math, same canvas calls) from the signal-sim section of
// frontend/index.html: startSim/stepSig/drawSignal plus the window selector and
// Holds/Breaks predict buttons that feed off the same selection. Re-expressed with
// useRef/useEffect instead of module-level globals + setInterval on `document`, but
// the drawing math and simulation step are untouched — no charting library, no rewrite.

const WINDOWS = ['5s', '15s', '25s', '30s', '1m', '2m', '3m', '5m', '15m', '30m', '1h']
const WSECS = [5, 15, 25, 30, 60, 120, 180, 300, 900, 1800, 3600]
const BUCKETS = 34
const holdProb = (i: number) => Math.max(22, Math.min(84, Math.round(80 - i * 4.4)))
const breakProb = (i: number) => Math.max(12, Math.min(80, Math.round(16 + i * 4.4)))

interface Sig {
  prob: number
  pmin: number
  pmax: number
  hist: number[]
  vol: number[]
}

interface PredictionLine {
  level: number
  side: 'hold' | 'break'
}

interface PredictMeta {
  mk: string
  side: 'hold' | 'break'
  level: number
  windowIdx: number
}

export function SignalChart({
  title,
  onOpenHow,
  matchId,
  oddKey,
  oddLabel,
  prob,
  predictionLines,
  isSelected,
  onAdd,
  onLiveProb,
}: {
  title: string
  onOpenHow: () => void
  matchId: string
  oddKey: string
  oddLabel: string
  prob: number
  predictionLines: PredictionLine[]
  isSelected: (id: string) => boolean
  onAdd: (id: string, label: string, prob: number, meta: PredictMeta) => void
  onLiveProb?: (prob: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sigRef = useRef<Sig | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [activeWin, setActiveWin] = useState(7) // default 5m
  const [pills, setPills] = useState({ r: '—', l: '—', s: '—' })

  const i2p = useCallback((sig: Sig, i: number) => sig.pmin + (i / (BUCKETS - 1)) * (sig.pmax - sig.pmin), [])
  const p2i = useCallback(
    (sig: Sig, p: number) => Math.round(((p - sig.pmin) / (sig.pmax - sig.pmin)) * (BUCKETS - 1)),
    [],
  )
  const nodes = useCallback((v: number[]) => {
    const mx = Math.max(...v, 1)
    return v
      .map((vv, i) => ({ i, v: vv }))
      .filter((n) => n.v > mx * 0.55)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4)
  }, [])

  const drawSignal = useCallback(() => {
    const cv = canvasRef.current
    const sig = sigRef.current
    if (!cv || !sig) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = devicePixelRatio || 1
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const padL = 30,
      plotR = w * 0.8,
      profL = w * 0.82,
      profR = w - 2,
      padT = 8,
      padB = 14
    const y = (p: number) => padT + (1 - (p - sig.pmin) / (sig.pmax - sig.pmin)) * (h - padT - padB)
    ctx.strokeStyle = '#262f3a'
    ctx.lineWidth = 1
    ctx.font = '9px "JetBrains Mono"'
    ctx.fillStyle = '#5a6573'
    const span = sig.pmax - sig.pmin,
      tstep = span > 60 ? 20 : span > 30 ? 10 : 5,
      t0 = Math.ceil(sig.pmin / tstep) * tstep
    for (let t = t0; t < sig.pmax; t += tstep) {
      ctx.beginPath()
      ctx.moveTo(padL, y(t))
      ctx.lineTo(profR, y(t))
      ctx.stroke()
      ctx.fillText(String(t), 4, y(t) + 3)
    }
    const ns = nodes(sig.vol),
      set = new Set(ns.map((n) => n.i)),
      mx = Math.max(...sig.vol, 1)
    ns.forEach((n) => {
      const p = i2p(sig, n.i),
        r = p > sig.prob
      ctx.globalAlpha = 0.16 + (n.v / mx) * 0.22
      ctx.strokeStyle = r ? '#f3596b' : '#2fc079'
      ctx.lineWidth = Math.max(1, (n.v / mx) * 5)
      ctx.beginPath()
      ctx.moveTo(padL, y(p))
      ctx.lineTo(plotR, y(p))
      ctx.stroke()
    })
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#5BC8D6'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    sig.hist.forEach((p, i) => {
      const x = padL + (i / (sig.hist.length - 1)) * (plotR - padL)
      if (i) ctx.lineTo(x, y(p))
      else ctx.moveTo(x, y(p))
    })
    ctx.stroke()
    ctx.strokeStyle = '#F2B43D'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(padL, y(sig.prob))
    ctx.lineTo(profR, y(sig.prob))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#F2B43D'
    ctx.beginPath()
    ctx.arc(plotR, y(sig.prob), 3.5, 0, 7)
    ctx.fill()
    sig.vol.forEach((v, i) => {
      const p = i2p(sig, i)
      if (p < sig.pmin || p > sig.pmax) return
      const bw = (v / mx) * (profR - profL),
        nd = set.has(i),
        r = p > sig.prob
      ctx.fillStyle = nd ? (r ? '#f3596b' : '#2fc079') : '#262f3a'
      ctx.globalAlpha = nd ? 0.9 : 0.5
      ctx.fillRect(profL, y(p) - 2.6, Math.max(1, bw), 5.2)
    })
    ctx.globalAlpha = 1

    // prediction lines on this odd — pending picks + placed (active) predictions
    const seen = new Set<string>()
    predictionLines.forEach((ln) => {
      const tag = ln.side + ':' + ln.level
      if (seen.has(tag)) return
      seen.add(tag)
      const yy = y(ln.level),
        col = ln.side === 'hold' ? '#2fc079' : '#f3596b'
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = col
      ctx.globalAlpha = 0.85
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(padL, yy)
      ctx.lineTo(plotR, yy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.fillStyle = col
      ctx.font = '9px "JetBrains Mono"'
      ctx.textAlign = 'left'
      ctx.fillText('◆ your call ' + ln.level + '%', padL + 3, yy - 3)
      ctx.restore()
    })

    const sup = ns.filter((n) => i2p(sig, n.i) < sig.prob).sort((a, b) => b.v - a.v)[0]
    const res = ns.filter((n) => i2p(sig, n.i) > sig.prob).sort((a, b) => b.v - a.v)[0]
    setPills({
      l: sig.prob.toFixed(1) + '%',
      s: sup ? i2p(sig, sup.i).toFixed(0) + '%' : '—',
      r: res ? i2p(sig, res.i).toFixed(0) + '%' : '—',
    })
    onLiveProb?.(sig.prob)

    // x time axis — reads the selected window
    const wsecs = WSECS[activeWin] || 300
    const ft = (s: number) => (s < 60 ? s + 's' : s % 3600 === 0 ? s / 3600 + 'h' : s % 60 === 0 ? s / 60 + 'm' : (s / 60).toFixed(1) + 'm')
    ctx.fillStyle = '#5a6573'
    ctx.font = '9px "JetBrains Mono"'
    ctx.textAlign = 'left'
    ctx.fillText('-' + ft(wsecs), padL, h - 3)
    ctx.textAlign = 'center'
    ctx.fillText('-' + ft(Math.round(wsecs / 2)), (padL + plotR) / 2, h - 3)
    ctx.textAlign = 'right'
    ctx.fillText('now', plotR, h - 3)
    ctx.textAlign = 'left'
  }, [activeWin, i2p, nodes, predictionLines, onLiveProb])

  const stepSig = useCallback(() => {
    const sig = sigRef.current
    if (!sig) return
    const ns = nodes(sig.vol)
    let pull = 0
    if (ns.length) {
      let b = ns[0],
        bd = 1e9
      for (const n of ns) {
        const d = Math.abs(i2p(sig, n.i) - sig.prob)
        if (d < bd) {
          bd = d
          b = n
        }
      }
      pull = i2p(sig, b.i) - sig.prob
    }
    sig.prob = Math.max(
      sig.pmin + 0.5,
      Math.min(sig.pmax - 0.5, sig.prob + pull * 0.18 + (Math.random() - 0.5) * 1.4 + (Math.random() < 0.04 ? (Math.random() - 0.5) * 6 : 0)),
    )
    sig.hist = sig.hist.slice(-55).concat(sig.prob)
    sig.vol[Math.max(0, Math.min(BUCKETS - 1, p2i(sig, sig.prob)))] += 2 + Math.random() * 3
  }, [i2p, nodes, p2i])

  // (re)starts the sim whenever a different odd is selected — matches startSim(prob) in the original
  useEffect(() => {
    let p = Math.max(2, Math.min(98, prob))
    let pmin = Math.round(p - 18),
      pmax = Math.round(p + 18)
    if (pmin < 1) {
      pmax += 1 - pmin
      pmin = 1
    }
    if (pmax > 99) {
      pmin -= pmax - 99
      pmax = 99
    }
    pmin = Math.max(1, pmin)
    const idx = (pp: number) => Math.max(0, Math.min(BUCKETS - 1, Math.round(((pp - pmin) / (pmax - pmin)) * (BUCKETS - 1))))
    const v = new Array(BUCKETS).fill(0).map(() => Math.random() * 8)
    v[idx(p - 6)] += 66
    v[idx(p + 7)] += 58
    v[idx(p)] += 38
    sigRef.current = { prob: p, pmin, pmax, hist: Array.from({ length: 56 }, () => p), vol: v }
    setActiveWin(7)
    drawSignal()

    const reduce = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (timerRef.current) clearInterval(timerRef.current)
    if (!reduce) {
      timerRef.current = setInterval(() => {
        stepSig()
        drawSignal()
      }, 850)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // Intentionally re-runs only when the selected odd changes (matchId/oddKey/prob) —
    // this mirrors startSim(prob) in the original, which restarts on a new odd, not on
    // window/predictionLines changes (those just redraw via the effect below).
  }, [matchId, oddKey, prob])

  useEffect(() => {
    drawSignal()
  }, [drawSignal])

  useEffect(() => {
    addEventListener('resize', drawSignal)
    return () => removeEventListener('resize', drawSignal)
  }, [drawSignal])

  const b = `${matchId}-${oddKey}`
  const wi = activeWin
  const wl = WINDOWS[wi]
  const pb = Math.max(8, Math.min(92, prob))
  const sup = Math.round(pb - 6)
  const res = Math.round(pb + 7)
  const hp = holdProb(wi)
  const bpv = breakProb(wi)
  const holdId = `${b}-hold-${wi}`
  const breakId = `${b}-break-${wi}`

  return (
    <div className="sig">
      <div className="sigh">
        <span className="ttl">{title}</span>
        <span className="sigbadge">VOLUME SIGNAL</span>
        <button className="howbtn" onClick={onOpenHow} style={{ marginLeft: 'auto' }}>
          How it works
        </button>
      </div>
      <canvas ref={canvasRef} height={200}></canvas>
      <div className="sigfoot">
        <div className="sigpill">
          <div className="k">Resistance</div>
          <div className="v" style={{ color: 'var(--red)' }}>
            {pills.r}
          </div>
        </div>
        <div className="sigpill">
          <div className="k">Live</div>
          <div className="v" style={{ color: 'var(--amber)' }}>
            {pills.l}
          </div>
        </div>
        <div className="sigpill">
          <div className="k">Support</div>
          <div className="v" style={{ color: 'var(--green)' }}>
            {pills.s}
          </div>
        </div>
      </div>
      <div>
        <p className="predlbl">Predict the signal · tap to add</p>
        <div className="winrow">
          <span className="winlbl">Window</span>
          <div className="wchips">
            {WINDOWS.map((w, i) => (
              <span key={w}>
                {(i === 4 || i === 10) && <span className="wdiv"></span>}
                <button className={`wchip${i === wi ? ' on' : ''}`} onClick={() => setActiveWin(i)}>
                  {w}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="sigact">
          <button
            className={`sigbtn sup${isSelected(holdId) ? ' sel' : ''}`}
            onClick={() =>
              onAdd(holdId, `${matchId} · ${oddLabel}: holds ${sup}%+ within ${wl}`, hp, {
                mk: b,
                side: 'hold',
                level: sup,
                windowIdx: wi,
              })
            }
          >
            Holds {sup}%+
            <small>within {wl}</small>
          </button>
          <button
            className={`sigbtn res${isSelected(breakId) ? ' sel' : ''}`}
            onClick={() =>
              onAdd(breakId, `${matchId} · ${oddLabel}: breaks ${res}% within ${wl}`, bpv, {
                mk: b,
                side: 'break',
                level: res,
                windowIdx: wi,
              })
            }
          >
            Breaks {res}%
            <small>within {wl}</small>
          </button>
        </div>
      </div>
    </div>
  )
}

export { WINDOWS, WSECS }
export type { PredictionLine, PredictMeta }
