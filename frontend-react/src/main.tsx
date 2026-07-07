import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App.tsx'

// @coral-xyz/anchor and @solana/web3.js expect Node's Buffer to exist as a global.
window.Buffer = window.Buffer ?? Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'passkey', 'wallet'],
        // v3 dropped the SDK-level solana.cluster / solanaClusters config: devnet vs
        // mainnet-beta for embedded wallets is set in the Privy dashboard, not here.
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
