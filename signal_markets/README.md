# signal_markets

Non-custodial Solana settlement engine for prediction markets on second-order match signals, settled trustlessly off TxLINE's on-chain odds proofs - plus a group layer that pools predictions.

This is the deterministic-settlement core: `create_market → deposit → resolve_market → claim`, the group flow (`create_group → request_join/approve_member → group_deposit → claim_group`), and the TxLINE validation CPI seam.

## Design

Funds only ever exist as USDC inside program-owned PDA vaults. Resolution is permissionless: any keeper submits a TxLINE proof, the program CPIs into TxLINE's validator, and on success evaluates a deterministic HOLD/BREAK predicate to set the outcome. No trusted admin touches the result.

## Program surface

### Markets

| Instruction | Who | What |
|---|---|---|
| `create_market` | anyone | inits a `Market` PDA (fixture, odd, HOLD\|BREAK side, level, window, fee) + its USDC vault PDA; the signer is the market authority |
| `create_market_v2` | anyone | same as `create_market` plus an explicit `fee_recipient` stored as the authority, so the fee routes to a house wallet |
| `deposit` | user | stakes USDC on YES (predicate holds) / NO into the vault; records a `Position` |
| `resolve_market` | keeper (permissionless) | single-proof settlement - CPIs the TxLINE validator, then evaluates HOLD/BREAK against the verified value |
| `claim` | winner | pro-rata payout from the vault; `fee_bps` cut (on winnings only) routes to the market authority |

`create_market` (8 args) and `create_market_v2` (9 args) share the same `CreateMarket` accounts and account layout, so both instruction-data formats stay valid on the live program and markets from either are mutually readable.

### Groups

| Instruction | Who | What |
|---|---|---|
| `create_group` | anyone | opens a `Group` (name, `fee_bps`, visibility, roster); creator is the implicit first member |
| `request_join` | user | mints a pending `GroupMember` |
| `approve_member` | owner | approves a pending member, bumps `member_count` |
| `update_group` | owner | edits name / fee / visibility / roster |
| `leave_group` | member | closes their `GroupMember` (owner can't leave) |
| `group_deposit` | member/owner | stakes into a market as part of the group - funds join the market vault + totals; per-member accounting in a shared `GroupPool` + `GroupPosition` |
| `claim_group` | member | pro-rata payout from the market with the **group's** fee routed to the group owner |

## Accounts

- **Market** - `[b"market", fixture_id, odd_key, market_params, side, level, window_start]`; fixture/odd/params/level/window, HOLD\|BREAK side, per-side (YES/NO) totals, status/outcome, vault, authority, `fee_bps`.
- **Position** - `[b"position", market, owner, side]`; one per user per side (top-ups via `init_if_needed`).
- **Group** - `[b"group", owner, group_id]`; name, `fee_bps`, visibility, roster, `member_count`.
- **GroupMember** - `[b"member", group, member]`; approval flag (owner has none - they're the implicit first member).
- **GroupPool** - `[b"grouppool", group, market]`; the group's shared per-side totals in a market.
- **GroupPosition** - `[b"grouppos", group, market, member, side]`; one member's contribution.

## Settlement logic (`resolve_market`)

- If `now >= window_end` with no resolving proof yet: the default outcome wins outright (BREAK → NO, it never crossed; HOLD → YES, it was never defeated). `window_end` doubles as HOLD's challenge close.
- Otherwise the submitted `(value, proof)` is CPI-verified via `validate_with_txline`, then:
  - **BREAK** market, `value >= level` → resolves YES (the crossing happened).
  - **HOLD** market, `value < level` → resolves NO (defeated).
  - Any other value reverts with `ProofDoesNotResolve` rather than silently no-op'ing.

## Payout math (`claim` / `claim_group`)

```
winnings = stake * losing_total / winning_total     // pro-rata share of the losing pool
fee      = winnings * fee_bps / 10_000              // cut on winnings only
payout   = stake + (winnings − fee)
```

`claim` uses the market's `fee_bps` → market authority. `claim_group` uses the same math off a `GroupPosition`, with the group's `fee_bps` → group owner. All intermediate math is `u128` with checked ops.

## Build

Requires the Solana + Anchor toolchain (Anchor 0.30.1).

```bash
anchor build      # compiles + emits target/idl/signal_markets.json and target/types/signal_markets.ts
anchor deploy --provider.cluster devnet
```

## TxLINE validation seam

`validate_with_txline` (`src/lib.rs`) is the single integration point. On devnet, `TXLINE_PROGRAM_ID` points at the deployed `mock_validator` (approves any proof) so the full loop runs end-to-end. Swapping in the real validator is: set `TXLINE_PROGRAM_ID` to TxLINE's validator address, replace the placeholder CPI encoding with TxLINE's IDL-encoded `validate` call, and point the keeper's proof fetchers at the live endpoints - nothing else in the program or keeper changes.
