# volmarket-keeper

Autonomous settlement keeper for the `signal_markets` program. It watches TxLINE's odds feed, fetches the Merkle proof for each settling update, and calls `resolve_market` on-chain - which CPIs into TxLINE's validator and sets the outcome from the market's HOLD/BREAK predicate. No human in the loop once it's running.

It also **bootstraps** the opposing pool of new two-sided markets from its own USDC, so the losing side is never empty and winners get real payouts.

## Flow

```
TxLINE odds stream ──▶ keeper ──▶ match an update to open markets by SuperOddsType + MarketParameters
                                    │
                     predicate satisfied in-window? ──▶ fetch the update's Merkle proof (by messageId)
                                    │
                                    ▼
                          resolve_market(value, proof)  ──CPI──▶ TxLINE validate
                                    │                                  │ ok
                                    ▼                                  ▼
                          predicate evaluated ──────────────▶ outcome written on-chain
```

Two settlement paths:
- **Crossing (optimistic YES)** - when an odds update inside the market's window satisfies the predicate, fetch that update's proof by `messageId` and resolve.
- **Timeout (optimistic NO)** - at window close, if no crossing happened, the default outcome wins (BREAK loses, HOLD wins) without any proof.

Safety: re-checks on-chain `status` before every submit, tracks in-flight markets, and treats an `AlreadyResolved` error as a benign race (settlement is permissionless - any keeper can settle).

## Run

```bash
npm install
npm run dev                      # watch mode (tsx)
npm run mock                     # synthetic feed - resolves a market on devnet without a live match
npm run build && npm start       # real TxLINE feed
```

The keeper carries a self-contained IDL at `signal_markets.idl.json` (a copy of the program's `anchor build` output), so it runs without the `signal_markets/` workspace next to it (`IDL_PATH` defaults to `./signal_markets.idl.json`). The keeper keypair needs a little devnet SOL for fees, plus USDC if bootstrapping is enabled. Configuration is via `.env` (start from `.env.example`).

## Mock mode

`npm run mock` drives a synthetic odds feed for the first open fixture and emits an `ended` status, so the keeper resolves a market on devnet without waiting for a live match. For the CPI to succeed, `TXLINE_PROGRAM_ID` must point at the deployed `mock_validator` (approves any proof).

## Files

- `config.ts` - env + logger
- `txline.ts` - odds stream client + proof fetchers (the TxLINE integration seam)
- `markets.ts` - loads open markets from chain, mirrors the on-chain predicate
- `bootstrap.ts` - seeds the opposing pool of new markets so payouts are real
- `resolver.ts` - builds the Anchor client, sends `resolve_market`, idempotency guard
- `keeper.ts` - event loop, settlement decisions, deadline sweeper
- `mockFeed.ts` - synthetic feed + proof for local runs
- `index.ts` - entry point
