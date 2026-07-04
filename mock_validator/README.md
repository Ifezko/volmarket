# mock_validator

A demo-only stand-in for TxLINE's on-chain validator. It approves any proof so the full
loop — deposit → keeper → `resolve_market` (CPI) → payout — runs end-to-end on devnet
without the real TxLINE program. **Demo/test only; never deploy to mainnet.**

It's a native Solana program (not Anchor) on purpose: the `resolve_market` CPI forwards raw
proof bytes — empty in mock mode — and an Anchor program would reject data with no
discriminator. This one ignores data and accounts entirely.

## Build & deploy (devnet)

```bash
# build the SBF binary
cargo build-sbf

# deploy — this prints the Program Id (and writes a keypair under target/deploy)
solana program deploy target/deploy/mock_validator.so --url devnet
```

Copy the printed **Program Id** — call it `MOCK_ID`.

## Wire it in (3 places)

1. **signal_markets program** — set the validator address to `MOCK_ID`:
   ```rust
   pub const TXLINE_PROGRAM_ID: Pubkey = pubkey!("MOCK_ID");
   ```
   then `anchor build && anchor deploy --provider.cluster devnet`.
   (The `ResolveMarket` accounts pin `txline_program` to this address, so it must match.)

2. **keeper `.env`**:
   ```
   TXLINE_PROGRAM_ID=MOCK_ID
   ```

3. Make sure the keeper's `PROGRAM_ID` / `IDL_PATH` point at your deployed signal_markets.

## Run the whole loop

```bash
# 1. create a market + deposit on both sides (via your tests or the app on devnet)
# 2. start the keeper in mock mode
cd ../keeper && npm run mock
```

The mock feed drives synthetic odds, the keeper calls `resolve_market`, the CPI hits this
program (which approves), the predicate sets the outcome, and the market is resolved on
devnet. You'll see `resolved … tx=…` — open that in the explorer for the demo.

## Swapping in the real TxLINE validator

Delete this from the flow: set `TXLINE_PROGRAM_ID` to the real validator address, fill the
`validate_with_txline` CPI encoding in signal_markets, and point the keeper's proof
fetchers at the real endpoints (the TODOs in `keeper/src/txline.ts`). Nothing else changes —
the keeper and program don't know or care that this was a mock.
