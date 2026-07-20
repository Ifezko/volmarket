# Volmarket - Technical Documentation

A non-custodial Solana protocol where you predict the *volume signal* on a live match's odds - settled trustlessly against TxLINE's on-chain odds proofs.

Live at **[volmarket.xyz](https://volmarket.xyz)** (Solana devnet). The app is `frontend-react/` (React + Vite + Privy, on Vercel); the keeper runs as a long-lived process on Railway.

---

## 1. Core idea

Most prediction markets settle "who won." Volmarket lets you predict the **second-order signal** on each odd of a live match - where the money builds support and resistance, and whether the line holds or breaks. Each betting line (1X2, Over/Under) becomes a chart with a live volume profile; you pick an odd, read its signal, and predict it. Predictions are non-custodial USDC escrows that settle on-chain from TxLINE's cryptographic proofs - no operator holds funds, no oracle to trust. You can predict solo or pool with a group, and combine outcomes across odds into one shareable prediction code.

## 2. What it does

- Browse a board of live and upcoming matches, each showing a live signal sparkline.
- Open a match → select any odd → read its **volume signal** (a live probability tape plus a support/resistance profile derived from on-chain stake).
- Predict the signal - **Holds** (stays at/above a support level) or **Breaks** (reaches a resistance level) within a chosen time window; combine several into one slip with a copyable share code.
- Group up (public or invite-only, with a per-group fee), pool predictions into a shared market position, and settle on-chain.

## 3. Architecture

```
frontend-react (board → odd → live signal → predict / claim, solo or group)
      │  deposit USDC / claim                          ▲ read on-chain state
      ▼                                                │
signal_markets (Anchor program, devnet)  ── vault PDAs · HOLD|BREAK markets · pro-rata payout minus fee · groups
      ▲ resolve_market(value, proof)  ──CPI──▶ TxLINE txoracle validate_odds (VERIFIED on devnet) | mock_validator (fallback)
      │
keeper (off-chain service) ── watches TxLINE odds, matches open markets (SuperOddsType + MarketParameters),
      ▲                        reads the outcome's demargined probability, fetches the Merkle proof, fires resolve_market
      │
TxLINE feed ── StablePrice odds, each update anchored on Solana (live stream, or a recorded capture replayed through the same handler)
```

Components:
- **`signal_markets`** - the Anchor program. Escrow vault PDAs, `Market`/`Position` accounts, a permissionless `resolve_market` that CPIs the validator, pro-rata `claim` minus `fee_bps`, and a full group layer (`Group`/`GroupMember`/`GroupPool`/`GroupPosition`). Non-custodial throughout.
- **`keeper`** - a TypeScript service that watches the TxLINE odds stream, matches updates to open markets, reads the settling outcome's probability, fetches the Merkle proof, and submits `resolve_market`. It also seeds the opposing pool of new two-sided markets so payouts are real.
- **`mock_validator`** - a small native program that approves any proof. The real `validate_odds` CPI is verified on devnet (§7); the mock is the fallback the demo runs on, because proofs publish on a 5-minute epoch that short windows outrun (§8).
- **`frontend-react`** - the match board and per-odd signal terminal, plus the deposit/claim, combo-slip, and group flows. Country flags render from bundled SVGs rather than regional-indicator emoji, which don't render on Windows.

## 4. How the signal is calculated & verified

The signal is two layers, obtained and verified differently.

**The line (implied probability)** comes from TxLINE's **StablePrice** feed - demargined consensus odds, so the percentage reads as a true probability. Each odds update is an `Odds` record (`FixtureId`, `MessageId`, `Ts`, `SuperOddsType`, `MarketParameters`, `PriceNames[]`, `Prices[]`, `Pct[]`, `InRunning`). The implied probability for an outcome is its **`Pct[]`** entry - a 3-decimal percent string (e.g. `"39.432"`) parallel to `PriceNames[]`. That is what settles; on-chain it is scaled to an integer as `round(Pct × 1000)` (so `"39.432"` → `39432`). It is **not** `Prices[]`, which is decimal-odds × 1000. Every update is committed into a batch whose Merkle root is anchored on Solana.

**The volume (support/resistance)** comes from Volmarket's own escrow - aggregate stake-by-level, publicly-readable on-chain state. **Volume only *informs*; it never *settles*.** It shapes the displayed profile and suggests where a level sits, but no outcome is ever decided by internal stake. This wall is what makes the market non-manipulable: manufacturing internal volume moves the picture, not the payout.

**The level that settles** is snapped from TxLINE's anchored StablePrice at market open - support = current − δ, resistance = current + δ. Because the level is derived from public anchored odds (not user stake), no participant can manufacture the level they're predicting.

**Verification:** an odds update is provable via its Merkle proof (a two-stage `subTreeProof` + `mainTreeProof`); reconstruct the root and compare it to the on-chain root through TxLINE's `validate_odds` instruction. This is not theoretical here - the CPI is verified on devnet (§7). Because the profile is a pure function of public, anchored data, anyone recomputes it identically.

## 5. Settlement design

A market is **fixture, odd (SuperOddsType + MarketParameters + outcome), side (HOLD / BREAK), level L, window [t₀ … t₀+W]**. The odd identity keys on SuperOddsType **and** MarketParameters, so different Over/Under lines are distinct on-chain markets (`market_params` is part of the market PDA). `L` is snapped from the anchored StablePrice at t₀. `L` and the settling value share one scale: **demargined probability × 1000**, read from `Pct[]`.

- **HOLD** wins if the odd's implied probability stays **≥ L** for the whole window.
- **BREAK** wins if it reaches **≥ L** at any point in the window.

**Single-proof settlement.** You never prove "stayed above for the whole window" - you submit *one* anchored odds update:
- **BREAK** resolves the moment anyone submits the update where prob ≥ L (one Merkle proof → CPI into the validator). No such update by t₀+W ⇒ BREAK loses (window close is the timeout).
- **HOLD** is the mirror, settled **optimistically**: anyone may submit the single update where prob dipped **below** L to defeat it. If none is submitted by challenge close (window end) ⇒ HOLD wins.

Everything settles on the anchored line - internal stake never decides an outcome. The program is odds-only; score/stat markets are not implemented.

### Market instructions

1. `create_market(fixture_id, odd_key, market_params, side, level, window_start, window_end, fee_bps)` - opens the market and inits its USDC vault PDA. The signer is the market authority (the fee washes back to them). `create_market_v2(…, fee_recipient)` is the same, plus an explicit fee recipient so the protocol fee routes to a dedicated house wallet. Both coexist on the live program with identical account layouts.
2. `deposit(side, amount)` - stakes USDC into the vault on YES/NO; records a `Position`.
3. `resolve_market(value, proof)` - permissionless single-proof settlement (above).
4. `claim()` - winners take pro-rata payout from the vault, minus `fee_bps` on winnings.

Payout math (in `claim`, all `u128` with checked ops):
```
winnings = stake * losing_total / winning_total     // pro-rata share of the losing pool
fee      = winnings * fee_bps / 10_000              // cut on winnings only
payout   = stake + (winnings − fee)
```

## 6. Groups

A group is a named roster with its own fee that pools predictions into a shared market position.

- `create_group(group_id, name, fee_bps, visibility, roster)` - identity is `(owner, group_id)`, so one owner can run several groups. The owner is the implicit first member (`member_count` starts at 1, no `GroupMember` minted for them). `update_group` lets the owner edit name/fee/visibility/roster later.
- `request_join` mints a pending `GroupMember`; `approve_member` (owner only) flips it to approved and bumps `member_count`. `leave_group` closes a member's `GroupMember` (the owner can't leave).
- `group_deposit(side, amount)` stakes into a market **as part of the group**: funds enter the same market vault and count in `market.total_*` (group money competes in the real pool), but the per-member accounting lives in a shared `GroupPool` (group+market aggregate) and a `GroupPosition` (per member/side). The owner deposits without a `GroupMember`; other members must be approved.
- `claim_group()` pays a member their pro-rata payout - identical winnings math to `claim`, but keyed off the `GroupPosition` and with the **group's** `fee_bps` routed to the **group owner** (the group's house).

Because group stake flows into the market's own vault and totals, group and individual predictions settle against the same market outcome; each side is accounted exactly once (a `Position` or a `GroupPosition`), so the vault conserves.

## 7. Validation: the real TxLINE CPI

`resolve_market` CPIs into a validator program to check the submitted `(value, proof)`. The program pins exactly two acceptable addresses and branches on which one the caller passes:

| `txline_program` passed | Path |
|---|---|
| `TXLINE_VALIDATOR_ID` = `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | **Real TxLINE `txoracle`.** `proof` carries a borsh-encoded `OddsProofPayload`; the validator proves the `Odds` snapshot against the committed `daily_odds_merkle_roots` (sub-tree proof for odds within a fixture's batch, main-tree proof for that batch within the day's root). |
| `TXLINE_PROGRAM_ID` = `FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse` | `mock_validator` - approves any proof, so the predicate rides the keeper-supplied `value`. |

**The real path is deployed and verified on devnet.** A genuine two-stage TxLINE Merkle proof passed through the CPI in:

```
tx 5vPAbG89XBZkWTFw82HFEDjZDKbK6nFr9qqhPMztfG2Qobt2GpCeBDeFrwcVHmvsno3soZmEE4aniaswhj16uML2
   txoracle logs: Stage 1 SUCCESS (snapshot→summary), Stage 2 SUCCESS (summary→main root)
```

Reproduce with `keeper/scripts/verify-odds-proof-onchain.ts`, which borsh-encodes `OddsProofPayload` to mirror the Rust struct field-for-field. Two operational findings from that run: the roots account is the `txoracle insert_batch_root` target, and verification costs **~234k compute units**, so a resolve on this path must raise its compute budget.

The keeper selects the path with `MOCK_VALIDATOR` (default `true`) plus the `TXLINE_PROGRAM_ID` it passes. The running demo uses the mock - not because the integration is incomplete, but because of epoch timing.

## 8. Epoch timing: detection is instant, proof is not

TxLINE publishes odds proofs in **wall-clock 5-minute batches**. A datapoint becomes provable only after its interval closes and the batch publishes (`fetchPublishedOddsProof` computes the boundary and retries across the publication buffer).

That splits settlement into two clocks:

- **Detection is real-time.** The keeper sees a crossing on the stream the instant it happens, and settles on it.
- **Trustless verification lags ~5 minutes + a publication buffer.**

This is inherent to proof-anchored settlement, not lag that can be engineered away, and it interacts with the HOLD/BREAK asymmetry: a winning HOLD is optimistic and finalises the moment its window closes with no proof required, while a winning BREAK must be *proven* and therefore can't finalise until its batch publishes. The UI states this honestly - a result shows **provisional** at window close and upgrades to **verified** once the proof lands (`ResultModal`).

It is also why a demo runs on `mock_validator`: a sub-minute prediction window closes long before its proof batch exists.

## 9. Settlement receipts

Every keeper settlement records the exact datapoint that decided it: `messageId`, `ts`, the settling value, and the `resolve_market` signature (`keeper/src/receiptStore.ts`), served over `GET /receipt?market=<pubkey>`. The result modal renders that TxLINE datapoint beside a Solana Explorer link to the resolve transaction, so a user verifies the settlement against the feed and the chain instead of trusting the app.

## 10. Replay mode

The World Cup fixtures this was built against have finished, so the keeper can replay a capture of **real recorded TxLINE events** - real `messageId`s, real timestamps, real demargined `Pct` values, recorded off the live stream by `keeper/scripts/capture-odds.ts` into `keeper/replay/odds-capture.json`.

With `REPLAY_FILE` set, `replayFeed.ts` emits those events through the **same `onEvent` handler** the live stream feeds, with gaps preserved and timestamps rebased onto the replay clock. Signal buffering, board seeding, the in-window settlement backstop and the post-window sweeper all run exactly as they do live; everything on-chain (markets, deposits, resolve, claim) stays real. Only the feed source changes. `replay/fanout.json` fans one capture across several fixture ids, each entering the recording at a different offset with its own level shift, so the board shows a full slate rather than one card.

The hackathon criteria explicitly allow **live OR simulated** TxLINE data feeds.

Replayed events carry their original `messageId`s, so TxLINE has no *current* proof batch for them - the real-validator path can't be exercised from a replay (§8). That path is verified separately (§7).

## 11. Current state

The full `create → deposit → resolve → claim` cycle and the group `create → join → group_deposit → claim_group` cycle both run end-to-end on devnet with real transaction signatures, against real TxLINE odds. The real `validate_odds` CPI is verified (§7).

Not built, stated plainly because some of it appears in the UI:

- **Two-sided liquidity is house-seeded, not a market.** The keeper bootstraps the opposing pool from its own USDC so a winner is paid the level's implied fixed odds rather than a thin pari-mutuel share (`keeper/src/bootstrap.ts`, capped by `BOOTSTRAP_MAX_USDC`). There is no order book and no external market maker.
- **Group activity stats** (`preds`, `pnl`, `wr` on group cards) are not tracked on-chain and read 0 for real groups; the board also seeds demo group rows that are not on-chain accounts. Group *escrow* is real - `create_group` / `group_deposit` / `claim_group` are live instructions and per-member accounting lives in on-chain `GroupPool` / `GroupPosition` accounts.
- **AI insights** are not implemented.
