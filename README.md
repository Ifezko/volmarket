# Volmarket

Non-custodial Solana prediction protocol where you trade the **volume signal** on live football odds - predict whether a live odd **holds** its support level or **breaks** its resistance level within a chosen time window. Predictions are USDC escrows in program-owned vaults, settled trustlessly against TxLINE's on-chain odds proofs. Predict solo or pool with a group.

**Live at [volmarket.xyz](https://volmarket.xyz)** (Solana devnet).

---

## Repository layout

```
volmarket/
├── frontend-react/     The app - React + Vite + Privy, talks to the program on devnet (deployed to Vercel)
├── signal_markets/     Anchor program - escrow vaults, HOLD/BREAK markets, single-proof settlement, groups
├── keeper/             TypeScript service - watches TxLINE odds, fetches proofs, resolves markets
├── mock_validator/     Native Solana program that approves any proof (fallback settlement path)
├── api/                Vercel serverless function that funds a new wallet with devnet USDC
└── docs/
    └── volmarket-technical-doc.md   Architecture + settlement design
```

## How it works

```
frontend-react (board → odd → live signal → predict / claim, solo or group)
      │  deposit USDC / claim payout                    ▲ read on-chain state
      ▼                                                 │
signal_markets (Anchor program, devnet) ── vault PDAs · HOLD|BREAK markets · pro-rata payout minus fee
      ▲  resolve_market(value, proof) ──CPI──▶ TxLINE txoracle validate_odds (verified on devnet) | mock_validator (fallback)
      │
keeper (TS service) ── matches a TxLINE odds update to an open market by SuperOddsType + MarketParameters,
      ▲                 reads the outcome's demargined probability, fetches the Merkle proof, calls resolve_market
      │
TxLINE feed ── StablePrice odds, each update anchored on Solana (live stream, or a recorded capture replayed through the same handler)
```

**The line settles; volume only informs.** Internal stake shapes the displayed support/resistance profile and suggests a level - it never decides an outcome. Every settlement rides on TxLINE's anchored odds proof, which is what keeps the market non-manipulable.

A market is `{ fixture, odd (SuperOddsType + MarketParameters + outcome), side (HOLD|BREAK), level L, window [t0 … t0+W] }`. The odd identity keys on SuperOddsType **and** MarketParameters, so different Over/Under lines (1.5 vs 2.5) are distinct markets. `L` and the settling value share one scale: the demargined implied probability × 1000 (a 3-decimal percent as an integer). **HOLD** wins if the probability stays ≥ L for the window; **BREAK** wins if it reaches ≥ L within it. Settlement is single-proof: submit the one anchored update that decides it (HOLD is optimistic - submit-to-disprove).

Confirmed outcomes (matched by label against the record's `PriceNames[]`): **1X2** `["part1","draw","part2"]` = home / draw / away, and **Over/Under** `["over","under"]`. BTTS is not in the feed, so the keeper and UI feature 1X2 and Over/Under only.

## Program surface

Markets:

| Instruction | Who | What |
|---|---|---|
| `create_market` | anyone | opens a market + USDC vault PDA (authority = the signer; fee washes back to them) |
| `create_market_v2` | anyone | same as `create_market` plus an explicit `fee_recipient` - routes the protocol fee to a house wallet |
| `deposit` | user | stakes USDC on YES (predicate holds) or NO into the vault; records a `Position` |
| `resolve_market` | anyone (permissionless) | single-proof settlement - CPIs the validator, then evaluates HOLD/BREAK on the verified value |
| `claim` | winner | pro-rata payout from the vault; `fee_bps` cut on winnings routes to the market authority |

Groups - a named roster with its own fee that pools predictions:

| Instruction | Who | What |
|---|---|---|
| `create_group` | anyone | opens a `Group` (name, fee, visibility, roster); creator is the implicit first member |
| `request_join` | user | mints a pending `GroupMember` |
| `approve_member` | owner | approves a pending member |
| `update_group` | owner | edits name / fee / visibility / roster |
| `leave_group` | member | closes their membership (owner can't leave) |
| `group_deposit` | member/owner | stakes into a market as part of the group - funds join the market pool; per-member accounting lives in a shared `GroupPool` + `GroupPosition` |
| `claim_group` | member | pro-rata payout from the market, with the **group's** fee routed to the group owner |

`create_market` (8-arg) and `create_market_v2` (9-arg) coexist so both instruction-data formats stay valid on the live program; account layout is identical, so markets from either path are mutually readable.

## Run it

**App** (`frontend-react/`)
```bash
cd frontend-react
npm install
npm run dev            # local dev server
npm run build          # production build (dist/)
```
Config is via `VITE_*` env vars (RPC URL, USDC mint, Privy app id, fund endpoint, fee recipient). All are client-side, non-secret. Sensible devnet defaults are baked in, so `npm run dev` works without any `.env`. Supply your own RPC URL if the public devnet endpoint rate-limits the account scans.

Country flags render from **bundled SVGs**, not emoji - regional-indicator emoji don't render on Windows, which would have left the board showing bare letter pairs.

**Program** (`signal_markets/`)
```bash
cd signal_markets
anchor build                                    # compiles + emits the IDL
anchor deploy --provider.cluster devnet
```
Written for Anchor 0.30.1. The program pins two validator addresses: `TXLINE_VALIDATOR_ID` (the real TxLINE `txoracle`) and `TXLINE_PROGRAM_ID` (the `mock_validator` the demo uses).

**Keeper** (`keeper/`)
```bash
cd keeper
npm install
npm run build && npm start       # live TxLINE feed
npm run mock                     # synthetic feed - resolves markets on the deployed devnet program

REPLAY_FILE=replay/odds-capture.json npm start   # replay real recorded TxLINE events
```
The keeper carries a self-contained copy of the IDL at `keeper/signal_markets.idl.json`. In deployment it runs as a long-lived process on Railway (see `DEPLOY.md`); it also serves the frontend's live signal feed over HTTP (`/signal`, `/fixtures`, `/receipt`).

## Deployed on devnet

| What | Address |
|---|---|
| `signal_markets` program | `86hERt8cdRZUBpc1Ng8coX2jwLmWGUcyc9JNfspw39yr` |
| TxLINE `txoracle` validator (= `TXLINE_VALIDATOR_ID`) | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| `mock_validator` program (= `TXLINE_PROGRAM_ID`) | `FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse` |
| App USDC mint | `3aakQUJ6vvWphAr18ZoAJfoHs3w148tWJmKsgsnUj12q` |

The full `create → deposit → resolve → claim` loop and the group `create → join → group_deposit → claim_group` loop both run end-to-end on devnet today, against real TxLINE odds.

### Real TxLINE proof verification

`resolve_market` CPIs into TxLINE's own on-chain `txoracle` validator, and that path is **implemented and verified on devnet**: a genuine two-stage TxLINE Merkle proof (snapshot → summary → main root) was verified through the CPI in

```
tx 5vPAbG89XBZkWTFw82HFEDjZDKbK6nFr9qqhPMztfG2Qobt2GpCeBDeFrwcVHmvsno3soZmEE4aniaswhj16uML2
    txoracle logs: Stage 1 SUCCESS (snapshot→summary), Stage 2 SUCCESS (summary→main root)
```

Reproduce it with `keeper/scripts/verify-odds-proof-onchain.ts`. Verification costs ~234k compute units, so a resolve tx on that path must raise its compute budget.

Which validator a resolve uses is chosen by the `txline_program` account the caller passes - the program accepts only those two addresses. **The running demo passes `mock_validator`**, selected by the keeper's `MOCK_VALIDATOR` env flag (default `true`). That is a timing constraint, not a gap in the integration: see epoch timing below.

### Epoch timing (why proofs lag detection)

TxLINE publishes odds proofs in **wall-clock 5-minute batches**. A datapoint is only provable once its interval has closed and the batch is published, so:

- **Detection is real-time.** The keeper sees the crossing on the stream the moment it happens and settles on it.
- **Trustless verification lags by ~5 minutes plus a publication buffer** (`fetchPublishedOddsProof` in `keeper/src/txline.ts` waits for the boundary and retries).

This gap is inherent to proof-anchored settlement, not lag that can be engineered away. It is also why the demo runs on `mock_validator`: a sub-minute prediction window closes long before its proof batch exists, and a replayed capture has no *current* batch at all. The UI reflects the same reality - a result shows **provisional** at window close and upgrades to **verified** when the proof lands (`ResultModal`).

### Settlement receipts

Every keeper settlement records the exact datapoint that decided it - `messageId`, `ts`, the settling value, and the `resolve_market` signature - served over `GET /receipt?market=<pubkey>`. The result modal shows that TxLINE datapoint next to a Solana Explorer link to the resolve transaction, so a user can check the settlement against both sources rather than trusting the app.

### Replay mode

`keeper/replay/odds-capture.json` holds **real recorded TxLINE events** - real `messageId`s, real timestamps, real demargined `Pct` values - captured from the live stream by `keeper/scripts/capture-odds.ts`. With `REPLAY_FILE` set, `replayFeed.ts` replays them through the *same* `onEvent` handler the live stream feeds, so signal buffering, board seeding, in-window settlement and the post-window sweeper all behave exactly as they do live. Everything on-chain stays real; only the feed source changes. `replay/fanout.json` fans one capture across several fixture ids, each entering the recording at its own offset with its own level shift, so a demo shows a full board.

This exists because the World Cup fixtures the app was built against have finished. The hackathon criteria explicitly allow **live OR simulated** TxLINE data feeds.

## What is not built yet

Stated plainly, because the app renders some of it as UI:

- **Two-sided liquidity** is house-seeded, not a market. The keeper bootstraps the opposing pool from its own USDC (`BOOTSTRAP_LIQUIDITY_USDC`) so winners get real payouts at the level's implied odds; there is no order book and no external market maker.
- **Group activity stats** (`preds`, `pnl`, `wr` on group cards) are not tracked on-chain and read 0 for real groups. The board also seeds a handful of demo group rows that are not on-chain accounts.
- **AI insights** are not implemented at all.

Group *escrow itself* is real: `create_group` / `group_deposit` / `claim_group` are live instructions, group money enters the same market vault, and per-member accounting lives in on-chain `GroupPool` / `GroupPosition` accounts.

## Not legal or financial advice
This is a betting-adjacent product; regulatory treatment varies by jurisdiction. Get counsel before operating in specific markets.
