# signal_markets

Non-custodial Solana settlement engine for **group prediction markets on second-order match signals**, settled trustlessly off TxLINE's on-chain Merkle proofs. Built for the TxODDS World Cup hackathon — **Prediction Markets & Settlement** track.

This repo is the deterministic-settlement core: `create_market → deposit → resolve_market → claim`, plus the TxLINE validation CPI seam.

## Why it's structured this way

Funds only ever exist as USDC inside PDA vaults. Fiat on-ramping (naira → USDC) happens off-protocol via a third-party widget, so the licensing/KYC sits with the provider, not you. Resolution is permissionless: any keeper submits a TxLINE proof, the program CPIs into TxLINE's validator, and on success evaluates a deterministic HOLD/BREAK predicate to set the outcome. No trusted admin touches the result.

## Program surface

| Instruction | Who | What |
|---|---|---|
| `create_market` | host | inits a `Market` PDA (fixture, odd, HOLD\|BREAK side, level, window, fee) + its USDC vault PDA |
| `deposit` | user | stakes USDC on YES (predicate comes true) / NO into the vault; records a `Position` |
| `resolve_market` | keeper (permissionless) | single-proof settlement — CPIs the TxLINE validator, then evaluates HOLD/BREAK against the verified value |
| `claim` | winner | pro-rata payout from vault; `fee_bps` cut (on winnings only) routes to the market authority |

### Accounts
- **Market** — `[b"market", fixture_id, odd_key, side, level, window_start]`; fixture/odd/level/window, HOLD\|BREAK side, per-side (YES/NO) totals, status/outcome, vault, authority.
- **Position** — `[b"position", market, owner, side]`; one per user per side (top-ups via `init_if_needed`).

### Settlement logic (`resolve_market`)
- If `now >= window_end` with no resolving proof yet: the default outcome wins outright (BREAK → NO, it never crossed; HOLD → YES, it was never defeated). `window_end` doubles as HOLD's challenge close.
- Otherwise the submitted `(value, proof)` is CPI-verified via `validate_with_txline`, then:
  - **BREAK** market, `value >= level` → resolves YES immediately (the crossing happened).
  - **HOLD** market, `value < level` → resolves NO immediately (defeated).
  - Any other value doesn't move the market — the call reverts with `ProofDoesNotResolve` rather than silently no-op'ing.

### Payout math (in `claim`)
```
winnings = stake * losing_total / winning_total      // pro-rata share of the losing pool
fee      = winnings * fee_bps / 10_000               // cut taken on winnings only
payout   = stake + (winnings - fee)
```
All intermediate math is `u128` with checked ops; refund path for one-sided markets is a TODO.

## Build

Requires the Solana + Anchor toolchain locally (the sandbox this was scaffolded in couldn't install it — rustup's CDN was blocked and the distro Rust was too old for current transitive crates).

```bash
# toolchain (if needed)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # Solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# build + test
anchor build
anchor test
```

`anchor build` will generate the IDL and `target/types/signal_markets.ts` used by the test.

## TxLINE integration TODOs (the seams to fill)

1. **Program id** — replace `TXLINE_PROGRAM_ID` in `lib.rs` with the real validator address from
   https://txline-docs.txodds.com/documentation/programs/addresses
2. **CPI encoding** — `validate_with_txline` currently forwards raw `proof` bytes. Replace with the
   anchor-encoded `validate_stat` call (discriminator + args) and correct account metas, per the devnet IDL:
   https://txline-docs.txodds.com/documentation/programs/devnet
3. **Datapoint binding** — `resolve_market` takes `datapoint_value` from the caller. Bind it to the
   value the proof actually attests (parse it out of the verified message) so the keeper can't pass a
   value the proof doesn't cover.
4. **Keeper** — small off-chain service on the TxLINE SSE stream (scores + odds) that fetches the
   Merkle proof for the settling update and calls `resolve_market`. This is also your "autonomous
   operation" evidence for judging.

## Resolution modes
- **Deterministic** (lead the demo with these): final score / FT snapshot odds — one proof settles both sides.
- **Optimistic** (the novel signal hook): "did X happen in-window" existence claims — YES if a valid
  crossing proof lands before `deadline`, else NO, with a challenge window. Easy to prove true, hard to
  prove a negative, so design predicates accordingly.

## Naira on-ramp (off-protocol)
Embed a third-party NGN→USDC widget (Crossmint or Paychant are embed-friendly; Monica/Quidax are consumer fallbacks). USDC lands in the user's own wallet, then they sign `deposit`. Your program never touches fiat.
