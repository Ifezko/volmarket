# Setup

Local setup for the whole stack. Deployment lives in [DEPLOY.md](DEPLOY.md); architecture in [docs/volmarket-technical-doc.md](docs/volmarket-technical-doc.md).

Nothing here needs a secret to *run the app* — the frontend ships working devnet defaults. Secrets are only needed to run the keeper (a signing key) or to talk to TxLINE.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node | 24.x | frontend, keeper (Node 20 can't load Anchor's CJS named exports through native ESM) |
| Rust + Solana CLI | Solana 1.18.x | building/deploying the programs |
| Anchor | 0.30.1 | `signal_markets` |

A devnet keypair at `~/.config/solana/id.json` (`solana-keygen new`) is enough for the scripts; fund it with `solana airdrop 2 --url devnet`.

## 1. The app

```bash
cd frontend-react
npm install
npm run dev
```

Open the printed URL. It talks to the deployed devnet program with no `.env` at all. To override anything, copy `frontend-react/.env.example` to `.env` — every value is a client-side, non-secret `VITE_*` var (RPC URL, USDC mint, Privy app id, fund endpoint, fee recipient).

If the public devnet RPC rate-limits the account scans (the board goes empty with HTTP 429s), set `VITE_RPC_URL` to your own endpoint. **Supply your own API key** — none is committed here.

## 2. The programs

```bash
cd signal_markets
anchor build
anchor deploy --provider.cluster devnet
```

`mock_validator/` is a separate native program — see its README. Point the keeper's `TXLINE_PROGRAM_ID` at whichever validator you deploy.

## 3. The keeper

```bash
cd keeper
npm install
cp .env.example .env          # then fill in PROGRAM_ID + a signing key
```

Set **either** `KEEPER_KEYPAIR` (path to a keypair file, e.g. `~/.config/solana/id.json`) **or** `KEEPER_SECRET_KEY` (the key as a JSON byte array — what deployed hosts use). The wallet needs devnet SOL for fees, plus USDC if `BOOTSTRAP_LIQUIDITY_USDC > 0`.

Three ways to run it:

```bash
npm run build && npm start                        # live TxLINE feed (needs TxLINE access)
npm run mock                                      # synthetic feed, no TxLINE needed
REPLAY_FILE=replay/odds-capture.json npm start    # replay real recorded TxLINE events
```

Replay is the useful one outside a live match: `replay/odds-capture.json` holds genuine recorded TxLINE events, replayed through the same pipeline as the live stream. See the technical doc, §10.

The keeper also serves the frontend's signal feed over HTTP (`/signal`, `/fixtures`, `/receipt`) on `$PORT`. Point the app at it with `VITE_KEEPER_URL` if you're running your own.

## 4. Useful scripts

Run from `keeper/` with `npx tsx scripts/<name>.ts`:

| Script | Does |
|---|---|
| `capture-odds.ts` | records live TxLINE events into a replay capture |
| `verify-odds-proof-onchain.ts` | verifies a real TxLINE Merkle proof through the on-chain CPI |
| `seed-live-fixtures.ts` | opens markets for real fixtures from the TxLINE snapshot |
| `bootstrap-liquidity.ts` | seeds an existing market's empty pool |
| `check-worldcup-coverage.ts` | checks what the current TxLINE service level actually covers |

## Secrets checklist

Never commit: `.env`, `*id.json`, `.fee-wallet.json`, `.treasury.json`, or any RPC URL containing an API key. `.gitignore` covers these; `.env.example` files hold placeholders only.
