import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Ported verbatim (same math, same canvas calls) from the signal-sim section of
// frontend/index.html: startSim/stepSig/drawSignal. Re-expressed with useRef/useEffect
// instead of module-level globals + setInterval on `document`, but the drawing math and
// simulation step are untouched - no charting library, no rewrite. This is still a
// simulated tape, same as the original (there's no live TxLINE feed wired into the
// browser) - but it's now seeded from a real on-chain market's level, and "your call"
// lines are real deposited positions instead of pending slip picks. The window selector
// and Holds/Breaks buttons live in the predict panel; the selected window is passed in as
// `windowSecs` so the x time axis matches the window you're about to predict on.

const BUCKETS = 34

interface Sig {
  prob: number
  pmin: number
  pmax: number
  hist: number[]
  vol: number[]
}

export interface PredictionLine {
  level: number
  side: 'hold' | 'break'
  /** placed on-chain positions carry a status; undefined = a pending, not-yet-placed slip pick */
  status?: 'pending' | 'won' | 'lost'
}

export function SignalChart({
  title,
  onOpenHow,
  matchId,
  oddKey,
  prob,
  windowSecs,
  predictionLines,
  onLiveProb,
}: {
  title: string
  onOpenHow: () => void
  matchId: string
  oddKey: string
  prob: number
  windowSecs: number
  predictionLines: PredictionLine[]
  onLiveProb?: (prob: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sigRef = useRef<Sig | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [fs, setFs] = useState(false)
  const [pills, setPills] = useState({ r: '-', l: '-', s: '-' })

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

    // prediction lines on this odd - the wallet's real deposited positions (tagged won/lost/
    // pending once placed) plus any not-yet-placed slip picks (no status).
    const seen = new Set<string>()
    predictionLines.forEach((ln) => {
      const tag = ln.side + ':' + ln.level + ':' + (ln.status ?? 'slip')
      if (seen.has(tag)) return
      seen.add(tag)
      const yy = y(ln.level)
      let col: string, label: string, alpha: number
      if (ln.status === 'won') {
        col = '#2fc079'
        label = '✓ won ' + ln.level + '%'
        alpha = 0.95
      } else if (ln.status === 'lost') {
        col = '#f3596b'
        label = '✗ lost ' + ln.level + '%'
        alpha = 0.5
      } else {
        // Live status is shown ON the call line itself (no separate chip): the line goes green
        // WINNING once the tape reaches/holds the level, red LOSING otherwise - evaluated against
        // the current live value (sig.prob), so it updates every sim tick as the line moves.
        const winning = sig.prob >= ln.level
        col = winning ? '#2fc079' : '#f3596b'
        label = '◆ your call ' + ln.level + '% · ' + (winning ? 'WINNING ▲' : 'LOSING ▼')
        alpha = 0.9
      }
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = col
      ctx.globalAlpha = alpha
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
      ctx.fillText(label, padL + 3, yy - 3)
      ctx.restore()
    })

    const sup = ns.filter((n) => i2p(sig, n.i) < sig.prob).sort((a, b) => b.v - a.v)[0]
    const res = ns.filter((n) => i2p(sig, n.i) > sig.prob).sort((a, b) => b.v - a.v)[0]
    setPills({
      l: sig.prob.toFixed(1) + '%',
      s: sup ? i2p(sig, sup.i).toFixed(0) + '%' : '-',
      r: res ? i2p(sig, res.i).toFixed(0) + '%' : '-',
    })
    onLiveProb?.(sig.prob)

    // x time axis - real clock time, advancing left-to-right with the tape (no negative offsets).
    // The tape's right tip is the current moment; the axis spans the selected window before it. A
    // Holds/Breaks placed now settles one window later (now + windowSecs), shown top-right.
    const wsecs = windowSecs || 300
    const clock = (ms: number) =>
      new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const nowMs = Date.now()
    ctx.fillStyle = '#5a6573'
    ctx.font = '9px "JetBrains Mono"'
    ctx.textAlign = 'left'
    ctx.fillText(clock(nowMs - wsecs * 1000), padL, h - 3)
    ctx.textAlign = 'center'
    ctx.fillText(clock(nowMs - wsecs * 500), (padL + plotR) / 2, h - 3)
    ctx.textAlign = 'right'
    ctx.fillText(clock(nowMs), plotR, h - 3)
    // when a Holds/Breaks over the selected window would settle
    ctx.fillStyle = '#8b95a2'
    ctx.fillText('settles ' + clock(nowMs + wsecs * 1000), plotR, padT + 9)
    ctx.textAlign = 'left'

    // live % value pinned at the tip of the tape - drawn LAST so nothing overpaints it. Solid
    // amber pill with dark text for high contrast, sitting just above the dot (flips below if
    // there's no room), so the exact percentage is readable as the line moves.
    const lv = sig.prob.toFixed(1) + '%'
    ctx.font = 'bold 11px "JetBrains Mono"'
    const padX = 6
    const boxH = 17
    const boxW = ctx.measureText(lv).width + padX * 2
    let bx = Math.min(plotR - boxW + 2, w - boxW - 1)
    bx = Math.max(padL, bx)
    let by = y(sig.prob) - boxH - 6
    if (by < padT) by = y(sig.prob) + 6
    by = Math.max(padT, Math.min(by, h - padB - boxH))
    ctx.fillStyle = '#F2B43D'
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(bx, by, boxW, boxH, 5)
      ctx.fill()
    } else {
      ctx.fillRect(bx, by, boxW, boxH)
    }
    ctx.fillStyle = '#12161b'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(lv, bx + padX, by + boxH / 2 + 0.5)
    ctx.textBaseline = 'alphabetic'
  }, [i2p, nodes, predictionLines, onLiveProb, windowSecs])

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

  // (re)starts the sim whenever a different odd is selected - matches startSim(prob) in the original
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
    // Intentionally re-runs only when the selected odd changes (matchId/oddKey/prob) -
    // this mirrors startSim(prob) in the original, which restarts on a new odd, not on
    // every redraw-triggering prop change (those just redraw via the effect below).
  }, [matchId, oddKey, prob])

  useEffect(() => {
    drawSignal()
  }, [drawSignal])

  useEffect(() => {
    addEventListener('resize', drawSignal)
    return () => removeEventListener('resize', drawSignal)
  }, [drawSignal])

  // Toggling fullscreen changes the canvas box; redraw on the next frame so it picks up the
  // new client width/height. Escape exits fullscreen (and, while fullscreen, is swallowed so
  // it doesn't also close the whole match - see VolmarketApp's global Escape handler).
  useEffect(() => {
    const r = requestAnimationFrame(() => drawSignal())
    return () => cancelAnimationFrame(r)
  }, [fs, drawSignal])
  useEffect(() => {
    if (!fs) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setFs(false)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [fs])

  const panel = (
    <div className={`sig${fs ? ' fs' : ''}`}>
      <div className="sigh">
        <span className="ttl">{title}</span>
        <span className="sigbadge">VOLUME SIGNAL</span>
        <button className="howbtn" onClick={onOpenHow} style={{ marginLeft: 'auto' }}>
          How it works
        </button>
        <button className="fsbtn" onClick={() => setFs((f) => !f)} title={fs ? 'Exit fullscreen' : 'Fullscreen chart'} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen chart'}>
          {fs ? '✕ Exit' : '⛶'}
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
    </div>
  )

  // Fullscreen renders through a portal to <body> so no ancestor (a transform/backdrop-filter/
  // sticky column, etc.) can turn the fixed overlay into a contained box that leaves the nav
  // showing. Inline otherwise. The fs-change effect above repaints after the re-parent.
  return fs ? createPortal(panel, document.body) : panel
}
