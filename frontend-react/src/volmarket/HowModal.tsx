import { Sparkline } from './Sparkline'

// Ported verbatim from #howModal / openHow()/closeHow() in frontend/index.html.
export function HowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className={`howmodal${open ? ' show' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="howcard">
        <button className="x" style={{ position: 'absolute', top: 12, right: 14 }} onClick={onClose}>
          ×
        </button>
        <h3>How signals work</h3>
        <div style={{ marginBottom: 14 }}>{open && <Sparkline seed="howto" prob={62} height={72} />}</div>
        <p>
          The <b style={{ color: 'var(--cyan)' }}>blue line</b> is the live chance of this outcome — it moves as the
          match plays.
        </p>
        <p>
          Money stacks up at certain levels: a{' '}
          <b style={{ color: 'var(--green)' }}>floor it keeps bouncing off (support)</b> and a{' '}
          <b style={{ color: 'var(--red)' }}>ceiling it struggles to break (resistance)</b>.
        </p>
        <p>
          You predict whether the line <b>holds the floor</b> or <b>breaks the ceiling</b> within your chosen time
          window.
        </p>
        <p className="hownote">
          Signals are sharpest when lots of money is trading. Thin markets are noisier — treat them with care.
        </p>
        <button className="btn btn-blue" style={{ width: '100%', marginTop: 4 }} onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  )
}
