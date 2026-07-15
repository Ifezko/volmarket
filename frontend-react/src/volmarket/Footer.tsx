export function Footer({
  onGoHome,
  onOpenHow,
  onOpenGroupsView,
  onOpenDeposit,
}: {
  onGoHome: () => void
  onOpenHow: () => void
  onOpenGroupsView: () => void
  onOpenDeposit: () => void
}) {
  const link = { cursor: 'pointer' } as const
  return (
    <footer>
      <div className="wrap">
        <div className="fcols">
          <div>
            <div className="logo" style={{ fontSize: 16, marginBottom: 8 }}>
              <img className="logomark" src="/volmarket-mark.png" alt="Volmarket" />
              Volmarket
            </div>
            <p style={{ color: 'var(--dim)', maxWidth: '36ch', margin: 0 }}>
              Predict the volume signal on every odd. Live World Cup markets on Solana, settled on-chain.
            </p>
          </div>
          <div>
            <h5>Markets</h5>
            <a style={link} onClick={onGoHome}>World Cup</a>
            <a style={link} onClick={onOpenHow}>Volume signals</a>
            <a style={link} onClick={onOpenGroupsView}>Groups</a>
          </div>
          <div>
            <h5>Product</h5>
            <a style={link} onClick={onOpenHow}>How signals work</a>
            <a style={link} onClick={onOpenHow}>Settlement</a>
            <a style={link} onClick={onOpenDeposit}>Deposit</a>
          </div>
          <div>
            <h5>Social</h5>
            <a href="https://x.com/volmarketxyz" target="_blank" rel="noopener noreferrer">X</a>
          </div>
        </div>
        <div className="legal" style={{ color: 'var(--faint)' }}>
          Volmarket is non-custodial. Outcomes settle against cryptographic match proofs anchored on Solana via
          TxLINE - released by code, never held by an operator. Predicting involves risk. Check the laws in your
          jurisdiction.
        </div>
      </div>
    </footer>
  )
}
