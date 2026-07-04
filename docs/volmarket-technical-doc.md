# Volmarket — Technical Documentation

**Track:** Prediction Markets & Settlement (TxODDS World Cup Hackathon)
**One line:** A non-custodial Solana protocol where you predict the *volume signal* on every available odd of a live match — settled trustlessly against TxLINE's on-chain Merkle proofs.

---

## 1. Core idea

Existing prediction markets settle "who won." Volmarket lets you predict the **second-order signal** on each odd of a live match — where the money builds support and resistance, and whether the line holds or breaks. Every betting line (1X2, over/under, BTTS, props) becomes a chart with a live volume profile; you pick a country or odd, read its signal, and predict it. Predictions are non-custodial USDC escrows that settle on-chain from TxLINE's cryptographic proofs — no operator holds funds, no oracle to trust. Users fund in USDC or in naira, predict solo or in groups, and can combine outcomes across odds into one shareable prediction code.

## 2. What it does

- Browse a board of live and upcoming World Cup matches, each showing a live signal sparkline.
- Open a match → select any **country or odd** → read its **volume signal** (live probability tape + a support/resistance profile shown from on-chain stake).
- Predict the signal — **Holds** (stays above a support level) or **Breaks** (reaches a resistance level) within a chosen time window; combine several into one slip with a shareable code.
- Group up (public or invite-only), fund in USDC or naira, settle on-chain.

## 3. Architecture

```
Frontend (match board → odd selector → live signal → predict/combine/group)
      │  deposit USDC                                  ▲ read on-chain state
      ▼                                                │
signal_markets (Anchor program)  ── escrow PDA, predicate, pro-rata payout, fee/cut
      ▲ resolve_market(value, proof)  ──CPI──▶ TxLINE validate (on-chain Merkle root)
      │
keeper (off-chain service) ── watches TxLINE SSE, fetches Merkle proof, fires resolve_market
      ▲
TxLINE ── StablePrice odds + scores, each update anchored on Solana
```

Four components, all built:
- **`signal_markets`** — Anchor program. Escrow vault PDAs, market/predicate/position accounts, permissionless `resolve_market` that CPIs into TxLINE's validator, pro-rata `claim` with a group fee (the "cut"). Non-custodial throughout.
- **`keeper`** — TypeScript service. Subscribes to the TxLINE stream, maps events to open markets (read from chain), fetches the Merkle proof for each settling datapoint, and submits `resolve_market`. This is the autonomous-operation piece.
- **`mock_validator`** — a tiny native program that approves any proof, so the full loop runs end-to-end on devnet for the demo without the live feed.
- **Frontend** — the match board and per-odd signal terminal, with combine/group/naira flows and an AI analyst.

## 4. How the signal is calculated & verified (the differentiator)

The signal is two layers, obtained and verified differently:

**The line (implied probability)** comes from TxLINE's **StablePrice** feed — demargined consensus odds, so the percentage reads as a true probability. Each odds update is an `Odds` record (`FixtureId`, `MessageId`, `Ts`, `SuperOddsType`, `PriceNames[]`, `Prices[]`, `InRunning`). The implied probability for an outcome is its `Prices[]` entry. Every update is committed into a batch whose Merkle root is anchored on Solana.

**The volume (support/resistance)** comes from Volmarket's own escrow — aggregate stake-by-level, publicly-readable on-chain state. Critically, **volume only *informs*; it never *settles*.** It shapes the displayed profile and suggests where a level sits, but no outcome is ever decided by internal stake. This hard wall is what makes the market non-manipulable: manufacturing internal volume moves the picture, not the payout.

**The profile** is a deterministic function of the anchored line and on-chain stake (bucket the probability axis, sum stake per bucket with optional time-decay, support/resistance = heaviest buckets below/above the line). Same inputs → same profile.

**The level that settles** is snapped from TxLINE's anchored StablePrice at market open — support = current − δ, resistance = current + δ. Because the level is derived from public anchored odds (not user stake), no participant can manufacture the level they're predicting.

**Verification:** the odds line is provable via `GET /api/odds/validation?messageId&ts`, which returns the `Odds` record plus a two-stage Merkle proof (`subTreeProof` + `mainTreeProof`); reconstruct the root and compare to the on-chain root through TxLINE's `validate` instruction. Because the profile is a pure function of public, anchored data, anyone recomputes it identically — that reproducibility is the verification, with no trusted oracle.

> Full detail in `signals-spec.md`.

## 5. Settlement design

A market is five things: **fixture, odd, side (HOLD / BREAK), level L, window [t₀ … t₀+W]**. L is snapped from the anchored StablePrice at t₀ (support = current − δ, resistance = current + δ; δ fixed per market type in v1, volatility-scaled later).

- **HOLD** wins if the odd's implied probability stays **≥ L** for the whole window.
- **BREAK** wins if it reaches **≥ L** at any point in the window.

**Lifecycle**
1. `create_market(side, L, window, …)` — opens the market, inits the USDC vault PDA.
2. `deposit(side, amount)` — stakes USDC into the vault; a `Position` is recorded.
3. `resolve_market(proof)` — **permissionless**, single-proof settlement (below).
4. `claim()` — winners take pro-rata payout from the vault, minus `fee_bps`. Non-custodial throughout.

**Single-proof settlement (cheap + trustless).** You never prove "stayed above the whole window" — you submit *one* anchored odds update:
- **BREAK** resolves the moment anyone submits the update where prob ≥ L (one Merkle proof → CPI into TxLINE `validate`). No such update by t₀+W ⇒ BREAK loses.
- **HOLD** is the mirror, settled **optimistically**: anyone may submit the single update where prob dipped **below** L to defeat it. If none is submitted by challenge close ⇒ HOLD wins.

Everything settles on the **anchored line**. There are no pure-volume markets — internal stake never decides an outcome. Score/stat-based markets (if offered) use the three-stage score proof.

**Manipulation resistance** (designed; parameters gated off for the devnet demo):
- **Line, not volume, settles** — the spine. Faking internal volume wins nothing.
- **Level from anchored odds** — L is derived from public StablePrice, so no one can manufacture the level.
- **Minimum-depth gate** — a market only counts once both sides hold enough stake, so no lone whale *is* the pot.
- **Position caps** — per-wallet share limited in thin markets.
- **Cadence floor** — sub-60s windows require TxLINE's paid real-time tier; the free 60s feed can't prove sub-minute crossings.

## 6. TxLINE endpoints used

| Purpose | Endpoint |
|---|---|
| Guest session JWT (30-day) | `POST /auth/guest/start` |
| Activate API token | `POST /api/token/activate` |
| Live odds — the signal line | `GET /api/odds/stream` (SSE) |
| Latest odds per market line | snapshots-of-the-latest-odds-for-a-fixture |
| **Odds Merkle proof — line settlement** | `GET /api/odds/validation?messageId&ts` → `OddsValidation { odds, summary, subTreeProof, mainTreeProof }` |
| Live scores | `GET /api/scores/stream` (SSE) |
| **Score three-stage proof — stat settlement** | scores three-stage validation |
| On-chain validation (CPI target) | TxLINE program (Program Addresses + devnet/mainnet IDL) |

All data calls send `Authorization: Bearer {JWT}` and `X-Api-Token: {token}`.

## 7. Business & technical highlights

- **Novel surface:** no one else turns each odd into a verifiable volume chart you predict on. It's a genuinely new primitive on top of standard prediction markets, and it fits the track's "Prediction Market Viewer" + settlement-engine briefs at once.
- **Trustless by construction:** funds in PDAs, permissionless proof-driven resolution, the "cut" as a programmatic fee — built as rails, not a book, which is the right side of the gambling-law line.
- **Growth mechanics:** combine outcomes into one prediction with a copyable share code; groups (public/invite-only) with shared upside. Both are viral loops the track's example list doesn't have.
- **Onboarding wedge:** naira on-ramp (USDC default, naira optional) brings the next wave of African users who don't already hold USDC — a real distribution edge for this team's market.
- **Verifiable AI:** an AI analyst reads price, momentum and the on-chain money into a falsifiable call — assistive, never the settlement authority.

## 8. How this maps to the judging criteria

- **Core functionality & data ingestion** — live TxLINE odds/scores drive the markets; keeper ingests the SSE stream.
- **Autonomous operation** — the keeper resolves markets with no human in the loop; `resolve_market` is permissionless.
- **Logic & architecture** — deterministic predicate, on-chain Merkle verification via CPI, clean account model.
- **Production readiness** — non-custodial escrow, idempotent single-proof resolution, and an explicit manipulation-resistance design (line-settles / level-from-anchored-odds / depth gate / position caps / cadence floor); devnet-deployable today via the mock validator.

## 9. Feedback on the TxLINE API

**What worked well**
- On-chain anchoring of *both* odds and scores is the thing that made this product possible — being able to settle a price-threshold market against a provable odds update (not a trusted feed) is exactly the missing primitive. Cleanly documented per-`messageId` proofs.
- Canonicalised, consistently-ordered records with stable ids made mapping fixtures → markets straightforward.
- The free World Cup tier with zero-cost real-time access removed all data-cost friction for building.
- SSE streams + per-fixture snapshots is a good combination — stream for live, snapshot for state recovery on reconnect.
- Publishing the on-chain program addresses and devnet/mainnet IDL up front made the CPI integration tractable.

**Where we hit friction**
- **Odds vs scores proof asymmetry:** odds use a two-stage proof (`subTreeProof` + `mainTreeProof`) while scores use a three-stage proof. Reasonable, but the difference isn't obvious from the endpoint names and cost us a wrong assumption early — a one-line note on each proof page would help.
- **`ts` requirement:** the odds validation endpoint needs both `messageId` *and* `ts`. Since `messageId` is described as unique, needing `ts` too was surprising; documenting *why* (batch lookup) would save a round trip.
- **`Prices[]` scale:** the integer encoding/scale of `Prices` (basis points? implied-prob ×100?) isn't stated inline, so we had to infer it from a sample. A units note on the `Odds` schema would remove ambiguity.
- **Free-tier 60s sampling:** the 60-second cadence is fine for most in-play signals but limits fine-grained "did it cross in this 10s window" markets; clarifying which markets are viable per tier would help product scoping.
- **StablePrice market coverage:** demargined StablePrice is noted as currently focused on key soccer markets — an explicit per-market coverage list for the World Cup would let us decide which odds to expose as signals with confidence.
- **JWT/token lifecycle:** the 30-day JWT plus separate API token is clear once read, but a short "refresh before expiry / handle 401" recipe in the quickstart would be a nice ergonomic addition for long-running services like our keeper.
