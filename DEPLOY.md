# Deploying Volmarket

Four pieces, four homes - they deploy independently.

| Piece | Where | Why |
|---|---|---|
| `frontend-react/` | **Vercel** (live at [volmarket.xyz](https://volmarket.xyz)) | Vite build; talks only to public RPC + read-only chain state. |
| `signal_markets/` + `mock_validator/` | **Solana devnet** | The programs live where the data is. |
| `keeper/` | **An always-on host - Railway in this deployment** (Fly.io or a VPS work too) - **not** Vercel | A long-lived process that watches a stream, polls the chain, and serves the frontend's signal feed; serverless functions won't keep it alive. |
| everything (this repo) | **GitHub** | Source of truth the others build from. |

---

## Programs → Solana devnet

```bash
cd signal_markets
anchor build
anchor deploy --provider.cluster devnet
```

`anchor build` produces `signal_markets/target/idl/signal_markets.json`. Note the deployed program id and set it as `PROGRAM_ID` for the keeper. Deploy `mock_validator` too (see its README) and point `TXLINE_PROGRAM_ID` at it.

The program accepts two validator addresses for `resolve_market`: the real TxLINE `txoracle` (`TXLINE_VALIDATOR_ID`, verified on devnet - see the README) and `mock_validator` (`TXLINE_PROGRAM_ID`). To settle through the real validator, set `MOCK_VALIDATOR=false` on the keeper, point `TXLINE_PROGRAM_ID` at the txoracle address, and raise the resolve tx's compute budget (verification costs ~234k CU).

## Frontend → Vercel

Point a Vercel project at the repo. The root `vercel.json` already sets the build:

- **Build command:** `cd frontend-react && npm install && npm run build`
- **Output directory:** `frontend-react/dist`

Set the app's `VITE_*` env vars in the Vercel project settings (RPC URL, USDC mint, Privy app id, fund endpoint, fee recipient). These are client-side and non-secret; Vite bakes them in at build time, so redeploy after changing one.

## Keeper → always-on host

A persistent Node process. Deploy it to something that keeps a process running.

```bash
cd keeper
npm ci
npm run build && npm start
```

The keeper carries a self-contained `signal_markets.idl.json`, so it runs without the `signal_markets/` workspace next to it (`IDL_PATH` defaults to `./signal_markets.idl.json`).

**Env** - set these on the host (start from `keeper/.env.example`):

| Var | Value |
|---|---|
| `TXLINE_NETWORK` | `devnet` |
| `SOLANA_RPC_URL` | your own RPC endpoint (blank → public devnet). Supply your own key; none is committed to this repo. |
| `PROGRAM_ID` | your deployed `signal_markets` id |
| `IDL_PATH` | `./signal_markets.idl.json` (default) |
| keeper signing key | via the host's secret manager (see below) |
| `TXLINE_*` | feed host / program / token / service level |
| `BOOTSTRAP_LIQUIDITY_USDC` | opposing-pool seed per new market (`0` disables) |
| `APP_USDC_MINT` | the app's USDC mint |
| `MOCK_VALIDATOR` | `true` (default) settles via `mock_validator`; `false` uses the real TxLINE validator |
| `REPLAY_FILE` | optional - replay a recorded TxLINE capture instead of the live stream, e.g. `replay/odds-capture.json` |

For two-sided markets to pay out, the keeper must be **running** and **funded** (SOL for fees, plus USDC if `BOOTSTRAP_LIQUIDITY_USDC > 0`, which it spends seeding empty pools).

Ready-made container artifacts live in `keeper/` (`Dockerfile`, `.dockerignore`, `.railwayignore`, `fly.toml`). On Fly.io: `fly launch --no-deploy --copy-config` → set secrets → `fly deploy`. On Railway: new service with root directory `keeper/` → set env vars → deploy (`railway up` from `keeper/` also works).

**Railway note:** some container hosts have broken IPv6 egress while Node 24 resolves DNS IPv6-first, which makes every RPC `fetch` fail with a bare `TypeError: fetch failed` and crash-loops the keeper on startup. `src/index.ts` forces IPv4-first (`setDefaultResultOrder("ipv4first")`); keep `NODE_OPTIONS=--dns-result-order=ipv4first` set as well.

## Secrets

- The keeper's signing key is set **only** through the host's secret manager - never committed, never baked into an image.
- Never commit `.env` (only `.env.example`, with placeholders) or any Solana keypair (`*id.json`, `.fee-wallet.json`, `.treasury.json`). `.gitignore` covers these.
- Never commit an RPC URL containing an API key. Config defaults in this repo are public endpoints only; supply your own key through env vars on the host.
- The frontend holds no secrets - only public RPC URLs, program ids, and mints.
- A leaked keeper key lets someone submit resolutions as you (wasted fees); a leaked wallet key can drain funds. If either is exposed, rotate immediately.
