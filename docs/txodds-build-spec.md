# Signal-Prediction Settlement Engine — TxODDS Build Spec

**Track:** Prediction Markets & Settlement (18k USDT pool, 12k first place)
**Submission deadline:** July 19, 2026 · **Winners:** July 29
**One-liner:** A non-custodial Solana protocol for *group* prediction markets on second-order match signals (odds movement, in-play thresholds, stat lines), settled trustlessly off TxLINE's on-chain Merkle proofs — funded in naira or USDC.

---

## 1. The money flow (4 layers — keep them separate)

The whole legal/architectural game is keeping fiat, custody, and settlement in separate boxes. Your program only ever touches USDC sitting in PDAs.

```
[1] ON-RAMP (off your protocol)
    User taps "Fund with Naira" → 3rd-party widget (Crossmint / Paychant)
    handles NGN→USDC, KYC, licensing → USDC lands in USER'S OWN wallet.
    You never touch naira. Provider holds the VASP license.
        │
        ▼
[2] DEPOSIT → ESCROW
    User signs deposit ix → USDC moves into a market-specific PDA vault.
    Program records position (side, amount, member).
        │
        ▼
[3] RESOLUTION (permissionless)
    Event concludes → ANY keeper fetches the TxLINE proof for the
    settling datapoint → CPI into TxLINE validate program → program
    writes the verified outcome. No trusted admin.
        │
        ▼
[4] PAYOUT / CLAIM
    Winners claim pro-rata from the PDA. Group "cut" is a fee_bps
    deducted programmatically on settlement — the creator never
    receives-and-redistributes. Non-custodial end to end.
```

**Why this passes the gambling-law framing:** you are building trustless rails, not operating a book. Funds live in PDAs, settlement is proof-driven, the "cut" is a protocol fee not a custodied pool. For the devnet demo this is clean; for the real product, the third-party ramp + non-custodial escrow keeps you off the money-transmitter line.

---

## 2. What's actually settleable (the TxLINE proof model)

TxLINE anchors **both scores and odds** on Solana, which is what makes signal-prediction viable rather than a trust-me feed:

- **Score stats** → three-stage Merkle proof for a single score statistic (e.g. total goals, corners).
- **Odds updates** → Merkle proof for a specific odds update, addressed by its unique `messageId`.

Each datapoint is in an hourly batch whose Merkle root is published on-chain. Your `resolve_market` ix takes the proof bytes and CPIs into TxLINE's validation instruction; if the proof reconstructs the on-chain root, the datapoint is verified.

### The one subtlety to design around: existence vs. absence

- **Easy to prove TRUE:** "Brazil ML dipped ≤ 1.50 in the 2nd half" → submit the *one* odds update (by `messageId`) whose proof shows the crossing. One proof settles YES.
- **Hard to prove FALSE:** proving it *never* crossed means proving a negative over the whole window — you'd need the full ordered set.

**So pick predicates that settle cleanly.** Two resolution modes:

| Mode | Use for | How it settles |
|---|---|---|
| **Deterministic** | Closed-form stats at a fixed point (final score, snapshot odds at FT) | Single proof from the snapshot endpoint settles both sides |
| **Optimistic** | "Did X happen during window" existence claims | YES if a valid crossing proof is submitted before `deadline`; else resolves NO. Add a short challenge window |

Lead your demo with deterministic markets (bulletproof), show one optimistic signal market as the novel hook.

---

## 3. Market schema

```rust
pub struct Market {
    pub market_id: u64,
    pub fixture_id: u64,
    pub market_type: MarketType,      // ScoreStat | OddsThreshold | OddsMovement
    pub predicate: Predicate,
    pub settlement_source: Source,    // ScoreProof | OddsProof
    pub resolution_mode: ResMode,     // Deterministic | Optimistic
    pub group_id: Option<Pubkey>,     // None = open market
    pub fee_bps: u16,                 // the group/protocol "cut"
    pub deadline: i64,                // settle-by (unix)
    pub vault: Pubkey,                // PDA holding USDC
    pub status: Status,               // Open | Locked | Resolved | Settled
    pub outcome: Option<bool>,
}

pub struct Predicate {
    pub stat_or_market_key: u32,      // e.g. moneyline-home, total-goals
    pub comparator: Comparator,       // Lte | Gte | Eq
    pub value: i64,                   // threshold (odds * 1000, or goal count)
    pub window_start: i64,            // minute or unix
    pub window_end: i64,
}
```

A market is just **a predicate over a TxLINE datapoint + a settlement source + a resolution mode**. That's the primitive; everything else (groups, open markets, prop bets) is a wrapper.

---

## 4. Group prediction mechanic

This is your differentiator and the track *explicitly* invites it ("trustless wagering pools, escrows, AMMs").

```
Group PDA {
    creator, members[], fee_bps, market_id, sub_vault
}
```

- Members deposit into the group's sub-vault for a shared market — everyone predicting the same outcome.
- On win, the program splits the vault pro-rata to each member's stake, **minus `fee_bps`** routed to the creator/treasury. That fee is the "cut," taken in-program — the creator never holds member funds.
- Share/join via a group link that encodes the group PDA. Joining = a deposit ix against that PDA.

Keep the cut as a programmatic fee and you stay non-custodial; the moment the creator receives-and-redistributes manually, you've become a pool operator.

---

## 5. Instruction set (the Anchor program)

```
create_market(predicate, source, mode, fee_bps, deadline)
    → inits Market PDA + USDC vault

create_group(market_id, fee_bps)
    → inits Group PDA + sub_vault

deposit(market_id | group_id, side, amount)
    → transfers USDC into vault, records Position

lock(market_id)            // optional: freeze at kickoff / window start

resolve_market(market_id, proof_bytes, datapoint)
    → CPI to TxLINE validate_stat
    → on success: write outcome, set status = Resolved
    (permissionless — any keeper can call)

claim(market_id)
    → computes pro-rata payout for caller's winning position
    → deducts fee_bps, transfers from vault
```

Resolution being permissionless is what makes it autonomous and trustless — run a tiny keeper that watches the TxLINE SSE stream and fires `resolve_market` when a settling event lands. That keeper is also your strongest "autonomous operation" evidence for the judges.

---

## 6. Demo video script (≤5 min — judged heaviest)

> Matches end after the deadline, so the video *is* the product. Make it show a full working loop on devnet.

**0:00–0:30 — Hook + problem.** Existing prediction markets settle "who won." Nobody lets you predict a match's *second-order signals* — and the few that try trust a centralized feed. Show the gap.

**0:30–1:15 — The product.** Live World Cup fixture. Create a signal market: "Brazil moneyline dips ≤ 1.50 in the 2nd half." Spin up a group, invite two friends, everyone stakes. A naira-only user taps **Fund with Naira** → ramp widget → USDC → stake. Show the group forming in real time.

**1:15–2:30 — Under the hood (the TxLINE requirement).** Show the SSE odds stream driving the live line. Surface a `messageId`. Fetch its Merkle proof. This is your "how TxLINE powers the backend" beat — make it explicit and visual.

**2:30–3:30 — Trustless settlement.** Odds cross the threshold → keeper submits the proof → `resolve_market` CPIs into TxLINE's validate ix → market resolves → escrow releases USDC pro-rata → group cut routes. Show the actual tx on the devnet explorer. This is the whole pitch in 60 seconds.

**3:30–4:15 — The vision.** "This World Cup engine is the proof-of-concept. The same settlement primitive points at Polymarket and Limitless markets after the tournament — a cross-platform signal layer. And the naira on-ramp onboards the next million African users who don't hold USDC." Frames scope as roadmap, not creep.

**4:15–4:45 — Close.** Repo link, devnet link, one line: "Non-custodial, proof-settled, here's the transaction on-chain."

---

## 7. Build order (3 weeks)

1. **Days 1–4:** Anchor program — `create_market` / `deposit` / `claim` with a *mocked* resolver. Get the escrow + pro-rata math right first.
2. **Days 5–8:** Wire `resolve_market` → real TxLINE CPI validation. Start with deterministic score markets (cleanest proof).
3. **Days 9–12:** Keeper bot on the SSE stream + the optimistic odds-signal market (the novel hook).
4. **Days 13–16:** Group PDA + join/share flow + fee routing.
5. **Days 17–19:** Front end, embed the naira ramp widget, polish, **record the demo with time to spare.**

Scope discipline: if you fall behind, ship deterministic score markets + groups + naira ramp and cut the optimistic signal market to a roadmap slide. A working trustless loop beats a half-built clever one — the judging criteria reward exactly that.

---

## 8. Submission checklist

- [ ] Demo video ≤5 min (Loom/YouTube) — hard requirement to pass screening
- [ ] Public GitHub repo
- [ ] Deployed link OR functional devnet endpoint judges can test
- [ ] Tech doc: core idea + the specific TxLINE endpoints used (list them — odds Merkle proof, score 3-stage proof, SSE streams, snapshots)
- [ ] Feedback note: what you liked / where you hit friction with the API
