# How Signals Are Calculated & Verified

This is the heart of the product, so it's worth being precise. A Volmarket "signal" is **two layers** that are obtained and verified differently:

1. **The line** — the implied probability of an outcome (the moving tape).
2. **The volume** — where stake has accumulated across probability levels (support / resistance).

The line comes from TxLINE and is cryptographically anchored on Solana. The volume comes from Volmarket's own on-chain escrow. The support/resistance profile is a deterministic function of the two, so anyone can recompute it from public, anchored data and get the identical result. That reproducibility is the verification — there is no oracle to trust.

---

## 1. The line — TxLINE StablePrice odds

Each outcome's implied probability is read from TxLINE's **StablePrice** feed: high-fidelity, *demargined* consensus pricing (the bookmaker margin is removed, so the percentage reads as a true probability).

**Source:** the real-time odds SSE stream, plus per-fixture snapshots.
- Stream: `GET /api/odds/stream` (Server-Sent Events)
- Latest per market line: `GET` snapshots-of-the-latest-odds-for-a-fixture

> On the free World Cup tier, odds are sampled **every 60 seconds** ("odds and off-the-board signals in real-time sampled every 60 seconds"). The paid tier is true low-latency real-time. So on the free tier the tape advances on a 60-second cadence — fine for in-play signals; just size the buckets and windows accordingly.

**An odds update (the `Odds` record) carries everything a market needs:**

| Field | Meaning |
|---|---|
| `FixtureId` | which match |
| `MessageId` | unique id of this update — the key to its proof |
| `Ts` | timestamp (also required to fetch the proof) |
| `SuperOddsType` | the market (1X2, over/under, BTTS, …) |
| `MarketParameters`, `MarketPeriod` | line params (e.g. 2.5) and period (FT/HT/in-running) |
| `PriceNames[]` | outcome labels (e.g. `["Home","Draw","Away"]`) |
| `Prices[]` | StablePrice values, integer-encoded, aligned to `PriceNames` |
| `InRunning` | live vs pre-match |

**Implied probability** for an outcome = its `Prices[]` entry (demargined StablePrice), indexed by `PriceNames`. That value, over time, is the cyan tape for that odd. (Confirm the integer scale — e.g. basis points — from one sample payload.)

---

## 2. The volume — Volmarket on-chain stake

Don't source volume from TxLINE: they publish consensus *odds*, not a verifiable order book, so a profile built from them couldn't be trustlessly checked. Source it from **your own escrow**.

Every prediction a user places is a `Position` recorded in the market PDA at the implied-probability level it was placed at. **Aggregate stake-by-level is the volume profile** — and it's native on-chain state anyone can read. The "money" in "where the money sits" is literally the USDC staked in Volmarket's markets.

---

## 3. Computing the profile (deterministic)

A pure function of two public inputs — anchored odds levels and on-chain stake:

```
bucket the probability axis into 1% levels (e.g. 46–84%)
for each Position with stake S placed at implied prob p:
    V[bucket(p)] += S            # optionally × time-decay so recent stake weighs more
support    = highest-volume bucket below the current line
resistance = highest-volume bucket above the current line
```

High-volume buckets are the support/resistance nodes. Same inputs → same profile, every time. Nothing subjective enters.

---

## 4. Verification — the part that matters

### 4a. Line verification (this is what settles money)

Each odds update is part of a batch whose Merkle root is committed on-chain. To prove a specific update is authentic:

**`GET /api/odds/validation?messageId={id}&ts={ts}`**
Headers: `Authorization: Bearer {JWT}`, `X-Api-Token: {token}`

Returns an `OddsValidation`:
- `odds` — the canonical `Odds` record
- `summary` — `OddsBatchSummary { fixtureId, updateStats, oddsSubTreeRoot }`
- `subTreeProof` — `ProofNode[]` (branch within the fixture's odds sub-tree)
- `mainTreeProof` — `ProofNode[]` (branch from the sub-tree root up to the batch root)

Each `ProofNode` is `{ hash, isRightSibling }`. So odds use a **two-stage proof**: hash the odds record, walk `subTreeProof` to the `oddsSubTreeRoot`, then walk `mainTreeProof` to the batch root, and compare to the **on-chain Merkle root**. If it reconstructs, the price point was provably published by the TxODDS Oracle. The on-chain `validate` instruction (TxLINE program, see Program Addresses + devnet/mainnet IDL) does this check in-program, which is what Volmarket's `resolve_market` CPIs into.

### 4b. Volume verification

The stake inputs are Volmarket's own PDA state, publicly readable on Solana. The profile is a deterministic function of (anchored odds levels) + (on-chain stake), so anyone can recompute it and get the identical support/resistance. **Reproducibility from public, anchored data is the verification.**

---

## 5. How a market actually settles

The profile tells you *where to set the line*; settlement rides on the *line*, not the profile.

- **Signal markets** ("stays above 58%", "breaks 71%") fix the level at creation (read off the profile at that moment) and settle on a **price threshold over a window** — resolved by the odds Merkle proof for the relevant `messageId`/`ts`. Easy to prove a crossing (submit the one update that crosses); for "held all window", use the optimistic submit-and-challenge path.
- **Pure-volume markets** (if offered) settle on on-chain stake totals — also fully verifiable, no external data.
- **Score/stat markets** settle via the **three-stage** score Merkle proof (`/api/scores/...validation`), a deeper hierarchy than odds.

In all cases the keeper fetches the proof and calls `resolve_market`, which CPIs into TxLINE's `validate` instruction; on success the deterministic predicate sets the outcome.

---

## 6. Trust model — what is and isn't trusted

- **Not trusted / never used for settlement:** any external book's traded volume (Polymarket, Kalshi, etc.). It isn't provable on Solana, so it can't back a trustless payout.
- **Trust-minimised:** TxLINE odds are relied on only insofar as each datapoint is anchored on-chain and provable via the validation endpoint + on-chain root. Volmarket doesn't ask users to trust the feed — it lets them verify it.
- **Fully on-chain:** the stake that forms the volume profile, and the settlement itself.

---

## 7. Endpoints used (summary for the tech-doc requirement)

| Purpose | Endpoint |
|---|---|
| Guest session JWT (30-day) | `POST /auth/guest/start` |
| Activate API token | `POST /api/token/activate` |
| Live odds (the line) | `GET /api/odds/stream` (SSE) |
| Latest odds per market line | snapshots-of-the-latest-odds-for-a-fixture |
| **Odds Merkle proof** (line settlement) | `GET /api/odds/validation?messageId&ts` → `OddsValidation` |
| Live scores | `GET /api/scores/stream` (SSE) |
| **Score three-stage proof** (stat settlement) | scores three-stage validation |
| On-chain validate (CPI target) | TxLINE program — Program Addresses + devnet/mainnet IDL |

All data calls send both `Authorization: Bearer {JWT}` and `X-Api-Token: {token}`.

---

### Correction worth carrying into the build
Odds proofs are **two-stage** (`subTreeProof` + `mainTreeProof`) and require **both** `messageId` *and* `ts`. Only *scores* use the three-stage proof. The keeper's `getOddsProof` should pass `ts` alongside `messageId`, and forward the `odds` record plus both proof arrays to the on-chain `validate` instruction.
