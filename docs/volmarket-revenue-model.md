# Volmarket — Revenue Model (one-pager)

*Non-custodial Solana prediction protocol. Earns from activity, never from outcomes. All figures below are illustrative assumptions, clearly flagged — swap your own in.*

---

## The five revenue lines

| # | Line | Rate | What it scales with | Margin |
|---|------|------|---------------------|--------|
| 1 | **Settlement commission** (rake) | dynamic, ~1.0% blended of settled volume | prediction volume | high |
| 2 | **Naira on-ramp spread** | 1.25% of naira deposits | every deposit (incl. losers) | high |
| 3 | **Volmarket Pro + Data/API** | $9/mo retail; $0.5–2k/mo B2B | subscribers + institutions | very high |

> **Groups and share codes are free, on purpose.** The rake already fires on every prediction when it settles — whether placed solo, in a group, or copied from a code. Charging a group cut or a copy-trade fee would double-tax volume you've already raked. Keep them frictionless: they're amplifiers of line ①, not separate tolls. The easier it is to group up or copy a slip, the more predictions settle, the more line ① earns.

---

## 1. The fee curve (the core engine)

Both Polymarket and Kalshi price the rake on a **probability-weighted curve** — highest near 50%, lowest at the extremes — because a coin-flip carries the most "action." Adopt the same shape in `fee_bps` instead of a flat rake:

```
fee(p) = PEAK × 4 · p · (1 − p)      // 4p(1−p) = 1 at p=0.5, → 0 at the edges
```

With **PEAK = 1.5%** on winnings:

| Outcome probability | Effective fee |
|---|---|
| 50% (toss-up) | 1.50% |
| 60% | 1.44% |
| 70% | 1.26% |
| 80% | 0.96% |
| 90% | 0.54% |

Blended across a realistic spread of markets this averages **~1.0%**. At scale, route part of it back as **maker rebates** to early liquidity providers (their playbook for keeping books deep) — net take then settles around **0.6%**.

> Non-custodial = **no float yield.** Kalshi earns interest on idle customer cash; you can't and shouldn't — it would break the trustless guarantee. Don't model it.

---

## 2. Unit economics — three stages

**Per-active-user monthly assumptions (illustrative):** $250 settled volume · $60 net new deposits (70% via naira on-ramp) · 4% convert to Pro at $9/mo.

| | Launch | Traction | Scale |
|---|---|---|---|
| Active users | 500 | 5,000 | 50,000 |
| Settled volume / mo | $125k | $1.25M | $12.5M |
| Naira deposit volume / mo | $21k | $210k | $2.1M |
| **① Settlement rake** | $1,250 (1.0%) | $11,250 (0.9%) | $75,000 (0.6%) |
| **② On-ramp spread** (1.25%) | $263 | $2,625 | $26,250 |
| **③ Pro subs** | $180 | $1,800 | $18,000 |
| **③ Data/API** (B2B, lumpy) | $0 | $2,000 | $15,000 |
| **≈ Monthly revenue** | **~$1.7k** | **~$17.7k** | **~$134.3k** |
| **≈ Annual run-rate** | ~$20k | ~$212k | ~$1.6M |

---

## 3. What it takes to hit a target

**Goal: $10k MRR.** At the assumptions above (~$3.5 revenue per active/mo) that's roughly **2,900 active users**, or about **$725k/mo in settled volume** plus their deposits and Pro conversions. Reachable between Launch and Traction.

Lever sensitivity (what moves the number most):
- **Volume is ~75–80% of revenue** at every stage. Everything rides on liquidity — the rake is worthless on thin markets. Win volume first.
- **On-ramp is your day-one line.** It pays from the very first deposit, before you have any volume, and earns on losers too. This is the Africa-first edge neither Polymarket nor Kalshi has — treat it as primary, not a footnote.
- **Pro + Data is small but pure margin.** Real-time sub-60s windows require the paid TxLINE tier anyway, so Pro is cost-pass-through-plus-margin. The signal feed/API to bots is the same "data as a second business" both incumbents now run (Polymarket via ICE, Kalshi via Tradeweb).

---

## 4. Sequencing

1. **Launch low** — sub-1% blended rake to win volume; eat the liquidity yourself early.
2. **Monetize the on-ramp from day one** — it doesn't need volume.
3. **Turn on maker rebates** once there are real LPs, to deepen books.
4. **Layer Pro + sell the signal API** once you have signal history worth paying for.

---

## 5. Honest constraints

- **No float.** Non-custodial by design — off the table, on purpose.
- **Volume dominates.** Thin markets make every fee here meaningless. Liquidity is the whole game.
- **Regulatory framing matters.** Frame income as **protocol fees + data subscriptions**, not "house edge" — Kalshi's sports revenue is its biggest line *and* its biggest legal exposure (criminal counts in Arizona, multi-state litigation). Get real counsel before charging in specific jurisdictions. *This is not legal or financial advice.*

---

*Benchmarks: Polymarket ~$375M annualized rev (May 2026) on a dynamic taker fee peaking ~1.56% at 50%, makers rebated, plus data licensing via ICE. Kalshi ~$1.5B annualized on fee = ⌈0.07·C·P·(1−P)⌉ (peak 1.75¢/contract at 50¢), plus interest-on-float and data/API.*
