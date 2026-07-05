# Volmarket

Non-custodial Solana prediction protocol where you trade the **volume signal** on every live football odd — predict whether a live odd **holds** support or **breaks** resistance within a chosen time window. Settled trustlessly against **TxLINE's** on-chain Merkle proofs. Built for the TxODDS World Cup Hackathon (Prediction Markets & Settlement track, deadline **2026-07-19**).

`volmarket.fun` · `@volmarketfun`

---

## What's in here

```
volmarket/
├── frontend/            Single-file prototype UI (open frontend/index.html in a browser)
├── signal_markets/      Anchor program — escrow, HOLD/BREAK markets, single-proof settlement
├── keeper/              TypeScript service — watches TxLINE, fetches proofs, resolves markets
├── mock_validator/      Native Solana program that approves any proof (devnet demo)
└── docs/
    ├── volmarket-technical-doc.md   Submission tech doc (core idea, settlement, endpoints, feedback)
    └── volmarket-revenue-model.md   Revenue one-pager (fee curve, on-ramp, unit economics)
```

## Architecture (runtime flow)

Runtime components only — the `docs/` folder holds submission deliverables, not runtime pieces.

```
Frontend (match board → odd selector → live signal → deposit / claim)
     │  deposit USDC / claim payout                    ▲ read on-chain state
     ▼                                                 │
signal_markets (Anchor program, devnet) ── escrow vault PDA · HOLD|BREAK markets · pro-rata payout
     ▲  resolve_market(value, proof) ──CPI──▶ TxLINE validator  (mock_validator on devnet;
     │                                          real TxLINE `validate` CPI = the one open seam)
keeper (TS service) ── watch odds → match an open market by SuperOddsType + MarketParameters
     ▲                    → read the outcome's Pct[] (× 1000) → fetch Merkle proof → resolve_market
     │
TxLINE oracle (oracle-dev.txodds.com) ── StablePrice odds, each update anchored on Solana
```

One sentence: TxLINE StablePrice odds (anchored on Solana) → `keeper` matches an update to an open market by **SuperOddsType + MarketParameters** and reads the outcome's demargined probability from **`Pct[]`** → calls `resolve_market(value, proof)` on `signal_markets` → which CPIs the validator to verify the proof → winners `claim` pro-rata from a non-custodial escrow PDA.

## Core design rule (do not break)

**The line settles; volume only informs.** Internal stake is used to *display* the support/resistance profile and *suggest* a level — it never decides an outcome. Every settlement rides on TxLINE's anchored odds proof. This is what makes the market non-manipulable; keep the wall between "informs" and "settles" intact.

A market = `{ fixture, odd (SuperOddsType + MarketParameters + outcome), side (HOLD|BREAK), level L, window [t0..t0+W] }`. The odd identity keys on SuperOddsType **and** MarketParameters, so different Over/Under lines (1.5 vs 2.5) are different markets. L and the settling value share one scale: the demargined implied probability × 1000 (a 3-decimal percent as an integer, read from `Pct[]`). **HOLD** wins if prob stays ≥ L for the window; **BREAK** wins if prob reaches ≥ L within it. Settlement is **single-proof**: submit the one anchored update that decides it (HOLD is optimistic / submit-to-disprove).

Confirmed outcome labels (matched against the record's `PriceNames[]`): **1X2** `["part1","draw","part2"]` = home / draw / away; **Over/Under** `["over","under"]`. **BTTS is not in the feed right now** — the keeper and UI feature 1X2 and Over/Under only.

---

## Run it

**Frontend** — just open `frontend/index.html` in a browser. Self-contained (no build step). All data is mocked/simulated; live matches animate a synthetic tape, upcoming matches show a "markets open at kickoff" state.

**Anchor program** (`signal_markets/`)
```bash
cd signal_markets
anchor build                                   # green; also generates the IDL
anchor deploy --provider.cluster devnet
```
Written for Anchor 0.30.1. `anchor build` compiles and emits the IDL. (Note: IDL codegen under `anchor build` needs a nightly that still has `proc_macro::Span::source_file` — `nightly-2024-08-31` works; the SBF program compile itself does not.) `TXLINE_PROGRAM_ID` is already set to the deployed `mock_validator` for the devnet demo.

**Mock validator** (`mock_validator/`) — the devnet CPI target that approves any proof; already deployed (id below). Rebuild with `cargo build-sbf` and redeploy if needed (see `mock_validator/README.md`).

**Keeper** (`keeper/`)
```bash
cd keeper
npm install
cp .env.example .env   # already wired for devnet: PROGRAM_ID + TXLINE_PROGRAM_ID (mock) + oracle-dev host
npm run mock           # fully-synthetic feed — resolves markets on the deployed devnet program
npm run build && npm start   # real TxLINE feed (start runs the compiled dist/)
```
The self-contained IDL lives at `keeper/signal_markets.idl.json` (copied from the anchor build). The keeper key loads in two modes: `KEEPER_SECRET_KEY` (a JSON byte array, for deployed hosts) takes priority, else the file at `KEEPER_KEYPAIR`.

**Full devnet loop** — `deposit → resolve → claim` runs end-to-end today. `keeper/scripts/demo-setup.ts` creates a market + deposits, `npm run mock` resolves it (CPI into `mock_validator`), and `keeper/scripts/demo-claim.ts` claims the winnings. See `DEPLOY.md` for the deploy/secret-hygiene guide.

## Deployed on devnet

| What | Address |
|---|---|
| `signal_markets` program | `86hERt8cdRZUBpc1Ng8coX2jwLmWGUcyc9JNfspw39yr` |
| `mock_validator` program (= `TXLINE_PROGRAM_ID`) | `FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse` |
| Devnet settlement mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| TxLINE API host (devnet) | `oracle-dev.txodds.com` |

Real-time data on devnet: TxLINE confirmed **Level 1 is not downgraded on devnet during the hackathon** — it delivers real-time (equivalent to mainnet Level 12), so sub-minute windows work on devnet Level 1. This parity is a hackathon accommodation and likely won't persist afterward.

---

## Build status: what's done, what's left

**Authoritative source for the open items:** [github.com/txodds/tx-on-chain](https://github.com/txodds/tx-on-chain) — the real IDL, program IDs, and working example scripts. The real API host is **`oracle(.-dev).txodds.com`**, not `txline.txodds.com` (docs/marketing site) or `txline-dev.txodds.com` (a separate Swagger UI).

### ✅ Done
- **`anchor build` green** and the **IDL is generated** (`signal_markets/target/idl/signal_markets.json`, copied to `keeper/`).
- **Full devnet loop works end-to-end** — `create → deposit → resolve → claim`, with real tx signatures. `resolve` runs via `npm run mock` and CPIs into the deployed `mock_validator`.
- **Pct / PriceNames mapping** — settlement reads the outcome's `Pct[]` (demargined implied probability, a 3-decimal percent string) as `round(Pct × 1000)`; **not** `Prices[]` (decimal-odds × 1000). Outcome resolved **by label** against `PriceNames[]`, never a raw index.
- **Odd identity = SuperOddsType + MarketParameters** — different Over/Under lines are distinct markets (`market_params` is part of the on-chain market PDA).
- **BTTS excluded** — not served by the feed; keeper + UI feature 1X2 and Over/Under only.
- **Dual-mode keeper key** — `KEEPER_SECRET_KEY` (env, deployed hosts) or `KEEPER_KEYPAIR` (file).
- **Self-contained IDL** — `keeper/signal_markets.idl.json`, so the keeper deploys without the `signal_markets/` workspace next to it.

### 🔧 Open (the real build work left)
1. **Real TxLINE `validate` CPI swap** — `validate_with_txline` in `signal_markets/programs/signal_markets/src/lib.rs` currently forwards a placeholder wire format. Replace it with the real IDL-encoded `validate` call, modeled on the tx-on-chain repo's on-chain validation example (`users.ts` / `validate_odds_onchain.ts`). Until then, `mock_validator` stands in on devnet.
2. **Real-auth wiring** — the keeper's `auth.ts` subscribe → sign → activate sequence for non-guest access, and confirming World Cup data coverage (`cd keeper && npm run check:worldcup` hits the real guest-JWT + snapshot endpoint). Mock mode skips auth entirely, which is why the devnet loop runs without it. Auth supports two paths: **guest-JWT-only** (`TXLINE_GUEST_ONLY=true`) and the full **on-chain subscribe → sign → activate**.

**Production safeguards** (designed, not built — deliberately, for the hackathon): minimum-depth gate, per-wallet position caps, δ scaling. See the "Manipulation resistance" section in `docs/volmarket-technical-doc.md`.

## Not legal or financial advice
Betting-adjacent product; regulatory treatment varies by jurisdiction. Frame revenue as protocol fees + data, and get counsel before charging in specific markets.
