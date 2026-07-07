import { Buffer } from 'buffer'

// Must run before any other module: @coral-xyz/anchor and its dependencies (e.g.
// @solana/spl-token-metadata) touch Buffer at module-load time, not just at call time.
// Loading this as its own <script type="module"> tag, before main.tsx's, guarantees it
// executes first — a Buffer assignment inside main.tsx itself would run too late, since
// ES module imports (including main.tsx's transitive deps) are all evaluated before any
// of main.tsx's own top-level statements.
window.Buffer = window.Buffer ?? Buffer
