import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import './index.css'
import App from './App.tsx'

// Register the wallet-standard connectors so Privy detects installed Solana
// extensions (Phantom, Solflare, Backpack…). Without this, 'wallet' login has
// no connectors to enumerate, so Privy shows "download" links even when the
// extension is already installed.
const solanaConnectors = toSolanaWalletConnectors()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'passkey', 'wallet'],
        // v3 dropped the SDK-level solana.cluster / solanaClusters config: devnet vs
        // mainnet-beta for embedded wallets is set in the Privy dashboard, not here.
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          // Sign transactions WITHOUT popping Privy's per-transaction confirmation UI.
          // Two reasons: (1) the product model is "fund your account once, then predict
          // freely" — a signing prompt on every bet defeats that; (2) that confirmation
          // modal was the blank screen users hit right after logging in to place a
          // prediction. With this off, useSignTransaction signs silently inside the
          // embedded-wallet iframe and we submit the tx ourselves.
          showWalletUIs: false,
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
