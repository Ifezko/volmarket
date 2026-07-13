# mock_validator

A devnet stand-in for TxLINE's on-chain validator. It approves any proof so the full loop - `deposit → keeper → resolve_market` (CPI) → payout - runs end-to-end on devnet without the real TxLINE program. **Devnet/test only; never deploy to mainnet.**

It's a native Solana program (not Anchor) on purpose: the `resolve_market` CPI forwards raw proof bytes - empty in mock mode - and an Anchor program would reject data with no discriminator. This one ignores data and accounts entirely and returns `Ok(())`.

## Build & deploy (devnet)

```bash
cargo build-sbf
solana program deploy target/deploy/mock_validator.so --url devnet
```

Copy the printed **Program Id** - call it `MOCK_ID`.

## Wire it in

1. **signal_markets** - set the validator address to `MOCK_ID`:
   ```rust
   pub const TXLINE_PROGRAM_ID: Pubkey = pubkey!("MOCK_ID");
   ```
   then `anchor build && anchor deploy --provider.cluster devnet`. (`ResolveMarket` pins `txline_program` to this address, so it must match.)
2. **keeper `.env`** - `TXLINE_PROGRAM_ID=MOCK_ID`, and make sure `PROGRAM_ID` / `IDL_PATH` point at your deployed `signal_markets`.

## Swapping in the real TxLINE validator

Set `TXLINE_PROGRAM_ID` to the real validator address, fill the `validate_with_txline` CPI encoding in `signal_markets`, and point the keeper's proof fetchers at the real endpoints. Nothing else changes - the keeper and program don't know or care that this was a mock.
