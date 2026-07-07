import './volmarket.css'
import { Nav } from './Nav'
import { Board } from './Board'
import { Footer } from './Footer'

// Top-level composition for the ported Volmarket product UI (see frontend/index.html).
// Built up one screen at a time — board + nav + footer land first; match detail, the
// combo slip, settlement, how-it-works, and groups follow in later commits.
export function VolmarketApp({
  walletAddress,
  onOpenDevnet,
}: {
  walletAddress: string | undefined
  onOpenDevnet: () => void
}) {
  return (
    <>
      <Nav
        comboCount={0}
        walletAddress={walletAddress}
        activeTab="product"
        onLogoClick={() => {}}
        onOpenDeposit={() => {}}
        onOpenSlip={() => {}}
        onOpenGroupsView={() => {}}
        onOpenDevnet={onOpenDevnet}
      />
      <Board onOpenMatch={() => {}} onOpenHow={() => {}} />
      <Footer />
    </>
  )
}
