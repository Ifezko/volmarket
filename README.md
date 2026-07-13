# Volmarket

Non-custodial Solana prediction protocol where you trade the **volume signal** on live football odds — predict whether a live odd **holds** its support level or **breaks** its resistance level within a chosen time window. Predictions are USDC escrows in program-owned vaults, settled trustlessly against TxLINE's on-chain odds proofs. Predict solo or pool with a group.

---

## Repository layout

```
volmarket/
├── frontend-react/     The app — React + Vite + Privy, talks to the program on devnet (deployed to Vercel)
├── signal_markets/     Anchor program — escrow vaults, HOLD/BREAK markets, single-proof settlement, groups
├── keeper/             TypeScript service — watches TxLINE odds, fetches proofs, resolves markets
├── mock_validator/     Native Solana program that approves any proof (devnet settlement stand-in)
└── docs/
    └── volmarket-technical-doc.md   Architecture + settlement design
```

## How it works

```
frontend-react (board → odd → live signal → predict / claim, solo or group)
      │  deposit USDC / claim payout                    ▲ read on-chain state
      ▼                                                 │
signal_markets (Anchor program, devnet) ── vault PDAs · HOLD|BREAK markets · pro-rata payout minus fee
      ▲  resolve_market(value, proof) ──CPI──▶ validator (mock_validator on devnet; real TxLINE validate = the integration seam)
      │
keeper (TS service) ── matches a TxLINE odds update to an open market by SuperOddsType + MarketParameters,
      ▲                 reads the outcome's demargined probability, fetches the Merkle proof, calls resolve_market
      │
TxLINE feed ── StablePrice odds, each update anchored on Solana
```

**The line settles; volume only informs.** Internal stake shapes the displayed support/resistance profile and suggests a level — it never decides an outcome. Every settlement rides on TxLINE's anchored odds proof, which is what keeps the market non-manipulable.

A market is `{ fixture, odd (SuperOddsType + MarketParameters + outcome), side (HOLD|BREAK), level L, window [t0 … t0+W] }`. The odd identity keys on SuperOddsType **and** MarketParameters, so different Over/Under lines (1.5 vs 2.5) are distinct markets. `L` and the settling value share one scale: the demargined implied probability × 1000 (a 3-decimal percent as an integer). **HOLD** wins if the probability stays ≥ L for the window; **BREAK** wins if it reaches ≥ L within it. Settlement is single-proof: submit the one anchored update that decides it (HOLD is optimistic — submit-to-disprove).

Confirmed outcomes (matched by label against the record's `PriceNames[]`): **1X2** `["part1","draw","part2"]` = home / draw / away, and **Over/Under** `["over","under"]`. BTTS is not in the feed, so the keeper and UI feature 1X2 and Over/Under only.

## Program surface

Markets:

| Instruction | Who | What |
|---|---|---|
| `create_market` | anyone | opens a market + USDC vault PDA (authority = the signer; fee washes back to them) |
| `create_market_v2` | anyone | same as `create_market` plus an explicit `fee_recipient` — routes the protocol fee to a house wallet |
| `deposit` | user | stakes USDC on YES (predicate holds) or NO into the vault; records a `Position` |
| `resolve_market` | anyone (permissionless) | single-proof settlement — CPIs the validator, then evaluates HOLD/BREAK on the verified value |
| `claim` | winner | pro-rata payout from the vault; `fee_bps` cut on winnings routes to the market authority |

Groups — a named roster with its own fee that pools predictions:

| Instruction | Who | What |
|---|---|---|
| `create_group` | anyone | opens a `Group` (name, fee, visibility, roster); creator is the implicit first member |
| `request_join` | user | mints a pending `GroupMember` |
| `approve_member` | owner | approves a pending member |
| `update_group` | owner | edits name / fee / visibility / roster |
| `leave_group` | member | closes their membership (owner can't leave) |
| `group_deposit` | member/owner | stakes into a market as part of the group — funds join the market pool; per-member accounting lives in a shared `GroupPool` + `GroupPosition` |
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
Config is via `VITE_*` env vars (RPC URL, USDC mint, Privy app id, fund endpoint, fee recipient). All are client-side, non-secret. Sensible devnet defaults are baked in, so `npm run dev` works without any `.env`.

**Program** (`signal_markets/`)
```bash
cd signal_markets
anchor build                                    # compiles + emits the IDL
anchor deploy --provider.cluster devnet
```
Written for Anchor 0.30.1. `TXLINE_PROGRAM_ID` points at the deployed `mock_validator` for the devnet demo.

**Keeper** (`keeper/`)
```bash
cd keeper
npm install
npm run mock                     # synthetic feed — resolves markets on the deployed devnet program
npm run build && npm start       # real TxLINE feed
```
The keeper carries a self-contained copy of the IDL at `keeper/signal_markets.idl.json`.

## Deployed on devnet

| What | Address |
|---|---|
| `signal_markets` program | `86hERt8cdRZUBpc1Ng8coX2jwLmWGUcyc9JNfspw39yr` |
| `mock_validator` program (= `TXLINE_PROGRAM_ID`) | `FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse` |
| App USDC mint | `3aakQUJ6vvWphAr18ZoAJfoHs3w148tWJmKsgsnUj12q` |

The full `create → deposit → resolve → claim` loop (and the group `create → join → group_deposit → claim_group` loop) runs end-to-end on devnet today. On devnet, `resolve` runs via the keeper and CPIs into `mock_validator`; swapping that CPI for TxLINE's real `validate` call is the remaining integration.

## Not legal or financial advice
This is a betting-adjacent product; regulatory treatment varies by jurisdiction. Get counsel before operating in specific markets.
