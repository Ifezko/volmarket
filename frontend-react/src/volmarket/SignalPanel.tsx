// Shell for the .sig volume-signal panel — ported markup from frontend/index.html's
// `middle` template in openMatch(). The canvas drawing (drawSignal/startSim), window
// selector, and Holds/Breaks predict buttons land in the next commit; for now this is
// a faithful static shell so the detail screen's layout is complete and reviewable.
export function SignalPanel({ title, onOpenHow }: { title: string; onOpenHow: () => void }) {
  return (
    <div className="sig">
      <div className="sigh">
        <span className="ttl">{title}</span>
        <span className="sigbadge">VOLUME SIGNAL</span>
        <button className="howbtn" onClick={onOpenHow} style={{ marginLeft: 'auto' }}>
          How it works
        </button>
      </div>
      <canvas id="sigCanvas" height={200}></canvas>
      <div className="sigfoot">
        <div className="sigpill">
          <div className="k">Resistance</div>
          <div className="v" style={{ color: 'var(--red)' }}>
            —
          </div>
        </div>
        <div className="sigpill">
          <div className="k">Live</div>
          <div className="v" style={{ color: 'var(--amber)' }}>
            —
          </div>
        </div>
        <div className="sigpill">
          <div className="k">Support</div>
          <div className="v" style={{ color: 'var(--green)' }}>
            —
          </div>
        </div>
      </div>
      <div id="sigCtrls"></div>
    </div>
  )
}
