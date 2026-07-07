import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  // @coral-xyz/anchor and @solana/web3.js assume a Node-ish global + Buffer, which Vite's
  // browser build doesn't provide. A separate <script> loaded before main.tsx used to
  // cover this, but Vite's production build merges both into one chunk with no guaranteed
  // load order — Buffer ended up undefined at runtime in prod (never caught by the dev
  // server, which preserves separate module graphs) and crashed the app before React ever
  // mounted, i.e. a blank page. `vite-plugin-node-polyfills` injects the shim via
  // esbuild/rollup's `inject` mechanism instead, which rewrites every module (dev prebundle
  // *and* production build) to have Buffer defined before its own top-level code runs —
  // the correct fix for this class of bug, not a script-ordering workaround.
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
})
