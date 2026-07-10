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
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. signal_markets.idl.json + txoracle.idl.json are committed,
# so they come in with the source copy below (no anchor workspace needed on the host).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Long-running process; no port to expose.
CMD ["node", "dist/index.js"]
