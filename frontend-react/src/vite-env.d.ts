/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string
  readonly VITE_RPC_URL?: string
  // Alchemy devnet fallback RPC for read calls when the primary endpoint throttles
  // getProgramAccounts. Provide either the full URL or just the API key.
  readonly VITE_ALCHEMY_RPC_URL?: string
  readonly VITE_ALCHEMY_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
