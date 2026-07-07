import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @coral-xyz/anchor and @solana/web3.js assume a Node-ish global + Buffer, which Vite's
  // browser build doesn't provide. `global` is polyfilled here; `Buffer` is polyfilled by
  // importing the `buffer` package once in main.tsx.
  define: {
    global: 'globalThis',
  },
})
