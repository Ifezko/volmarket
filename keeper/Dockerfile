# Keeper deploy image. Build context = this keeper/ directory.
#   docker build -t volmarket-keeper .
#   docker run --env-file .env volmarket-keeper      # or inject env on the host (see below)
#
# The keeper is a long-lived process (SSE stream + chain polling + bootstrap + settlement), so it
# runs on an always-on host (Fly.io / Railway / a VPS) — NOT Vercel. It needs, at runtime:
#   - KEEPER_SECRET_KEY : the keeper keypair as a JSON byte array (a Solana id.json's contents),
#                         injected as a host SECRET env var. Never bake it into the image or git.
#   - the on-chain config (PROGRAM_ID, SOLANA_RPC_URL, TXLINE_*, BOOTSTRAP_LIQUIDITY_USDC,
#                          APP_USDC_MINT) — see keeper/.env.example and DEPLOY.md.
#   - canonical USDC in the keeper wallet so bootstrap deposits can go through (fund-keeper.ts).
# Node 24 (not 20): Node 20's cjs-module-lexer can't extract Anchor's CJS named exports (BN, …)
# for a native ESM `import { BN } from "@coral-xyz/anchor"`, so it crashes at startup. Node 24's
# lexer resolves them — matches the local runtime the keeper is proven on.
FROM node:24-slim

WORKDIR /app

# Install deps first for layer caching. signal_markets.idl.json + txoracle.idl.json are committed,
# so they come in with the source copy below (no anchor workspace needed on the host).
COPY package.json package-lock.json ./
# --include=dev so tsx/typescript are installed even when the host sets NODE_ENV=production
# (tsx is the runtime — see CMD below).
RUN npm ci --include=dev

COPY . .

# Run via tsx (not tsc -> node dist), so Anchor's CommonJS named exports (BN, Program, …) load
# through esbuild's CJS/ESM interop. Native `node dist/*.js` fails with
# "Named export 'BN' not found" because the emitted ESM can't destructure Anchor's CJS exports.
# tsx is installed by `npm ci` (it's how the scripts run) and JIT-compiles TS at startup.
# Long-running worker; no port to expose.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
