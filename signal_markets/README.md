# signal_markets

Non-custodial Solana settlement engine for **group prediction markets on second-order match signals**, settled trustlessly off TxLINE's on-chain Merkle proofs. Built for the TxODDS World Cup hackathon — **Prediction Markets & Settlement** track.

This repo is the deterministic-settlement core: `create_market → deposit → resolve_market → claim`, plus a `create_group` layer and the TxLINE validation CPI seam.

## Why it's structured this way

Funds only ever exist as USDC inside PDA vaults. Fiat on-ramping (naira → USDC) happens off-protocol via a third-party widget, so the licensing/KYC sits with the provider, not you. Resolution is permissionless: any keeper submits a TxLINE proof, the program CPIs into TxLINE's validator, and on success evaluates a deterministic predicate to set the outcome. No trusted admin touches the result.

## Program surface

| Instruction | Who | What |
|---|---|---|
| `create_market` | host | inits `Market` PDA + USDC vault PDA over a `Predicate` |
| `create_group` | creator | inits a `Group` PDA (shared fee config / label) |
| `deposit` | user | stakes USDC on YES/NO into the vault; records a `Position` |
| `resolve_market` | keeper (permissionless) | CPIs TxLINE validator, then sets outcome from the predicate |
| `claim` | winner | pro-rata payout from vault; `fee_bps` cut routes to fee recipient |

### Accounts
- **Market** — config, predicate, per-side totals, status/outcome, vault.
- **Position** — `[b"position", market, owner, side]`; one per user per side (top-ups via `init_if_needed`).
- **Group** — `[b"group", group_id]`; creator, fee, member count.

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
