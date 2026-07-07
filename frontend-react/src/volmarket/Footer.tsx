// Ported verbatim from the <footer> markup in frontend/index.html.
export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="fcols">
          <div>
            <div className="logo" style={{ fontSize: 16, marginBottom: 8 }}>
              <span className="dot"></span>Volmarket
            </div>
            <p style={{ color: 'var(--dim)', maxWidth: '36ch', margin: 0 }}>
              Predict the volume signal on every odd. Live World Cup markets on Solana, settled on-chain.
            </p>
          </div>
          <div>
            <h5>Markets</h5>
            <a href="#">World Cup</a>
            <a href="#">Volume signals</a>
            <a href="#">Groups</a>
          </div>
          <div>
            <h5>Product</h5>
            <a href="#">How signals work</a>
            <a href="#">Settlement</a>
            <a href="#">Fund in naira</a>
          </div>
          <div>
            <h5>Social</h5>
            <a href="#">X</a>
            <a href="#">Discord</a>
            <a href="#">Telegram</a>
          </div>
        </div>
        <div className="legal" style={{ color: 'var(--faint)' }}>
          Volmarket is non-custodial. Outcomes settle against cryptographic match proofs anchored on Solana via
          TxLINE — released by code, never held by an operator. Predicting involves risk. Check the laws in your
          jurisdiction.
        </div>
      </div>
    </footer>
  )
}
