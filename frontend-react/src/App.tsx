import { usePrivy } from '@privy-io/react-auth'
import { VolmarketApp } from './volmarket/VolmarketApp'

// The real product (frontend/index.html) has no login wall at all — it's fully open. Privy
// auth is only prompted where it's actually needed (real predictions, deposits, withdrawals),
// inside VolmarketApp — never as a gate in front of the app.
function App() {
  const { ready } = usePrivy()
  if (!ready) return null
  return <VolmarketApp />
}

export default App
