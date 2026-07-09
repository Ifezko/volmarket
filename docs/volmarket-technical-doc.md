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
Frontend (match board → odd selector → live signal → deposit / claim)
      │  deposit USDC / claim                          ▲ read on-chain state
      ▼                                                │
signal_markets (Anchor program, devnet)  ── escrow vault PDA · HOLD|BREAK markets · pro-rata payout minus fee_bps
      ▲ resolve_market(value, proof)  ──CPI──▶ validator (mock_validator on devnet; real TxLINE validate = open seam)
      │
keeper (off-chain service) ── watches TxLINE odds, matches open markets (SuperOddsType + MarketParameters),
      ▲                        reads the outcome's Pct[] (× 1000), fetches the Merkle proof, fires resolve_market
      │
TxLINE oracle (txline-dev.txodds.com) ── StablePrice odds, each update anchored on Solana
```

Four components, all built:
- **`signal_markets`** — Anchor program. Escrow vault PDA + `Market`/`Position` accounts, permissionless `resolve_market` that CPIs the validator, pro-rata `claim` minus `fee_bps` (routed to the market authority). Non-custodial throughout.
- **`keeper`** — TypeScript service. Watches the TxLINE odds stream, matches updates to open markets by SuperOddsType + MarketParameters (read from chain), reads the settling outcome's `Pct[]`, fetches the Merkle proof, and submits `resolve_market`. This is the autonomous-operation piece.
- **`mock_validator`** — a tiny native program that approves any proof, so the full loop runs end-to-end on devnet for the demo without the real validator CPI.
- **Frontend** — the match board and per-odd signal terminal, with combine/group/naira flows and an AI analyst.

## 4. How the signal is calculated & verified (the differentiator)

The signal is two layers, obtained and verified differently:

**The line (implied probability)** comes from TxLINE's **StablePrice** feed — demargined consensus odds, so the percentage reads as a true probability. Each odds update is an `Odds` record (`FixtureId`, `MessageId`, `Ts`, `SuperOddsType`, `MarketParameters`, `PriceNames[]`, `Prices[]`, `Pct[]`, `InRunning`). The implied probability for an outcome is its **`Pct[]`** entry — a 3-decimal percent string (e.g. `"39.432"`) parallel to `PriceNames[]`. That is what settles; on-chain we scale it to an integer as `round(Pct × 1000)` (so `"39.432"` → `39432`). It is **not** `Prices[]`, which is decimal-odds × 1000 (e.g. `2536` = 2.536). Confirmed outcome labels: 1X2 (`1X2_PARTICIPANT_RESULT`) `PriceNames = ["part1","draw","part2"]` = home/draw/away; Over/Under (`OVERUNDER_PARTICIPANT_GOALS`) `PriceNames = ["over","under"]`, keyed together with `MarketParameters` (the goal line). BTTS is not in the feed right now. Every update is committed into a batch whose Merkle root is anchored on Solana.

**The volume (support/resistance)** comes from Volmarket's own escrow — aggregate stake-by-level, publicly-readable on-chain state. Critically, **volume only *informs*; it never *settles*.** It shapes the displayed profile and suggests where a level sits, but no outcome is ever decided by internal stake. This hard wall is what makes the market non-manipulable: manufacturing internal volume moves the picture, not the payout.

**The profile** is a deterministic function of the anchored line and on-chain stake (bucket the probability axis, sum stake per bucket with optional time-decay, support/resistance = heaviest buckets below/above the line). Same inputs → same profile.

**The level that settles** is snapped from TxLINE's anchored StablePrice at market open — support = current − δ, resistance = current + δ. Because the level is derived from public anchored odds (not user stake), no participant can manufacture the level they're predicting.

**Verification:** the odds line is provable via `GET /api/odds/validation?messageId&ts`, which returns the `Odds` record plus a two-stage Merkle proof (`subTreeProof` + `mainTreeProof`); reconstruct the root and compare to the on-chain root through TxLINE's `validate` instruction. Because the profile is a pure function of public, anchored data, anyone recomputes it identically — that reproducibility is the verification, with no trusted oracle.

## 5. Settlement design

A market is: **fixture, odd (SuperOddsType + MarketParameters + outcome), side (HOLD / BREAK), level L, window [t₀ … t₀+W]**. The odd identity keys on SuperOddsType **and** MarketParameters, so different Over/Under lines (1.5 vs 2.5) are distinct on-chain markets (`market_params` is part of the market PDA). L is snapped from the anchored StablePrice at t₀ (support = current − δ, resistance = current + δ; δ fixed per market type in v1, volatility-scaled later). L and the settling value share one scale: **demargined probability × 1000**, read from `Pct[]`.

- **HOLD** wins if the odd's implied probability stays **≥ L** for the whole window.
- **BREAK** wins if it reaches **≥ L** at any point in the window.

**Lifecycle** (actual on-chain signatures)
1. `create_market(fixture_id, odd_key, market_params, side, level, window_start, window_end, fee_bps)` — opens the market, inits the USDC vault PDA. `odd_key` selects the SuperOddsType + outcome; `market_params` carries the line (Over/Under goal line × 100; 0 for 1X2).
2. `deposit(side, amount)` — stakes USDC into the vault; a `Position` is recorded.
3. `resolve_market(value, proof)` — **permissionless**, single-proof settlement (below). The keeper matches a feed update to the market by SuperOddsType + MarketParameters, reads the outcome's `Pct[]` (× 1000) as `value`, then submits it with the proof.
4. `claim()` — winners take pro-rata payout from the vault, minus `fee_bps`. Non-custodial throughout.

**Single-proof settlement (cheap + trustless).** You never prove "stayed above the whole window" — you submit *one* anchored odds update:
- **BREAK** resolves the moment anyone submits the update where prob ≥ L (one Merkle proof → CPI into the validator). No such update by t₀+W ⇒ BREAK loses (window close is the timeout).
- **HOLD** is the mirror, settled **optimistically**: anyone may submit the single update where prob dipped **below** L to defeat it. If none is submitted by challenge close (window end) ⇒ HOLD wins.

Everything settles on the **anchored line**. There are no pure-volume markets — internal stake never decides an outcome. The program is odds-only; score/stat markets are not implemented.

**Working today on devnet:** the full `create → deposit → resolve → claim` cycle runs end-to-end with real transaction signatures. `resolve` executes via the keeper (`npm run mock`), which CPIs into the deployed `mock_validator` (approves any proof — demo stand-in). The one remaining seam is swapping that CPI for the real TxLINE `validate` call (see §9 / the repo README).

**Manipulation resistance** (designed; parameters gated off for the devnet demo):
- **Line, not volume, settles** — the spine. Faking internal volume wins nothing.
- **Level from anchored odds** — L is derived from public StablePrice, so no one can manufacture the level.
- **Minimum-depth gate** — a market only counts once both sides hold enough stake, so no lone whale *is* the pot.
- **Position caps** — per-wallet share limited in thin markets.
- **Cadence floor** — sub-60s windows require TxLINE's paid real-time tier; the free 60s feed can't prove sub-minute crossings.

## 6. TxLINE endpoints used

**API host:** `txline-dev.txodds.com` (devnet) / `txline.txodds.com` (mainnet) — per the live OpenAPI `servers:` block at https://txline-dev.txodds.com/docs. The old `github.com/txodds/tx-on-chain` repo was renamed to these hosts ~2 months ago; the earlier `oracle*.txodds.com` guess no longer resolves.

| Purpose | Endpoint |
|---|---|
| Guest session JWT (30-day) | `POST /auth/guest/start` |
| Activate API token | `POST /api/token/activate` |
| Live odds — the signal line | `GET /api/odds/stream` (SSE) |
| Latest odds per market line | snapshots-of-the-latest-odds-for-a-fixture |
| **Odds Merkle proof — line settlement** | `GET /api/odds/validation?messageId&ts` → `OddsValidation { odds, summary, subTreeProof, mainTreeProof }`; the outcome's demargined probability is `odds.Pct[]` (settle on this, × 1000) — not `odds.Prices[]` |
| Live scores | `GET /api/scores/stream` (SSE) |
| **Score three-stage proof — stat settlement** | scores three-stage validation (not used — the program is odds-only) |
| On-chain validation (CPI target) | TxLINE program (Program Addresses + devnet/mainnet IDL) |

All data calls send `Authorization: Bearer {JWT}` and `X-Api-Token: {token}`. Real-time on devnet: TxLINE confirmed **Level 1 is not downgraded on devnet during the hackathon** (real-time, equivalent to mainnet Level 12), so sub-minute windows work on devnet Level 1 — a hackathon accommodation that likely won't persist afterward.

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
- **Production readiness** — the full `create → deposit → resolve → claim` loop is **deployed and working on devnet today** (real tx signatures; `resolve` runs autonomously via the keeper, CPI'ing the mock validator). Non-custodial escrow, idempotent single-proof resolution, and an explicit manipulation-resistance design (line-settles / level-from-anchored-odds / depth gate / position caps / cadence floor). The one open seam is swapping the mock validator CPI for TxLINE's real `validate` call.

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
- **`Pct[]` vs `Prices[]` (resolved):** a record carries both `Prices[]` (decimal-odds × 1000) and `Pct[]` (demargined implied probability, a 3-decimal percent string). Settlement rides on `Pct[]`, but which field is the true probability — and its scale/units — isn't stated inline; we confirmed it from live payloads. A one-line units note on the `Odds` schema (`Pct` = demargined % with 3 decimals; `Prices` = decimal-odds × 1000) would remove all ambiguity.
- **Push markets carry no `Pct[]`:** some market types (shared-outcome / quarter Asian handicaps like 2.25, some over/unders) have 'push' behaviour and omit `Pct[]`; we skip these as unsettleable. Flagging push behaviour on the schema would help.
- **Free-tier 60s sampling:** the 60-second cadence is fine for most in-play signals but limits fine-grained "did it cross in this 10s window" markets; clarifying which markets are viable per tier would help product scoping.
- **StablePrice market coverage:** demargined StablePrice is currently focused on key soccer markets — confirmed live: **1X2** (`PriceNames ["part1","draw","part2"]`) and **Over/Under** (`["over","under"]`, keyed by `MarketParameters`) are served; **BTTS is not** in the feed right now. An explicit per-market coverage list for the World Cup would let us decide which odds to expose as signals with confidence.
- **JWT/token lifecycle:** the 30-day JWT plus separate API token is clear once read, but a short "refresh before expiry / handle 401" recipe in the quickstart would be a nice ergonomic addition for long-running services like our keeper.
