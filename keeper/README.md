# volmarket-keeper

Autonomous settlement keeper for the Volmarket markets program. It watches TxLINE's World Cup feed, fetches the Merkle proof for each settling datapoint, and calls `resolve_market` on-chain — which CPIs into TxLINE's validator and sets the outcome from the market's predicate. No human in the loop once it's running, which is the "autonomous operation" the track judges on.

## Flow

```
TxLINE SSE stream ──▶ keeper ──▶ match event to open markets
                                   │
                  settling datapoint? ──▶ fetch Merkle proof (score 3-stage | odds by messageId)
                                   │
                                   ▼
                         resolve_market(value, proof)  ──CPI──▶ TxLINE validate
                                   │                                  │ ok
                                   ▼                                  ▼
                         predicate evaluated ──────────────▶ outcome written on-chain
```

Three settlement paths:
- **Deterministic score** — on the settling stat (or match end), fetch the three-stage score proof and resolve. One proof settles both sides.
- **Odds crossing (optimistic YES)** — when an odds update inside the market's window satisfies the predicate, fetch that update's proof by `messageId` and resolve YES.
- **Optimistic NO** — at match end or the deadline sweep, if no crossing happened, submit the last odds update's proof (predicate fails → NO).

Safety: re-checks on-chain `status` before every submit, tracks in-flight markets, and treats an `AlreadyResolved` error as a benign race (any keeper can settle — it's permissionless).

## Run

```bash
cp .env.example .env      # fill in RPC, keeper keypair, program id, IDL path, TxLINE creds
npm install
npm run dev               # watch mode (tsx)
# or
npm run build && npm start
```

`IDL_PATH` should point at the IDL emitted by `anchor build` in the program repo
(`../signal_markets/target/idl/signal_markets.json`). The keeper keypair just needs a
little devnet SOL for fees — it earns nothing and touches no funds.

## Mock mode (for the demo)

```bash
npm run mock
```

Drives a synthetic odds feed for the first open fixture and emits an `ended` status, so
the keeper resolves a market on devnet without waiting for a live match. For the CPI to
succeed in mock mode, deploy a **mock validator** at `TXLINE_PROGRAM_ID` whose instruction
returns `Ok(())` for any input (a 10-line Anchor program), or temporarily stub the CPI in
`validate_with_txline`. This is the cleanest thing to show on camera: start the keeper,
watch it print `resolved … tx=…`, open the explorer link.

## TxLINE integration TODOs (the seams)

All in `src/txline.ts`:
1. `normaliseStreamEvent` — map the real World Cup stream payload to `TxEvent`.
2. `getScoreProof` / `getOddsProof` — point at the real proof endpoints; confirm query params.
3. `parseProof` — map their response fields (value, proof bytes, commitment/batch accounts).
   The `accounts` you return become the `remaining_accounts` the validator CPI reads.
4. In the program, fill `validate_with_txline` with the real `validate_stat` instruction
   encoding so the forwarded proof actually verifies.

## Files
- `config.ts` — env + logger
- `txline.ts` — SSE client + proof fetchers (integration seams live here)
- `markets.ts` — loads open markets from chain, mirrors the on-chain predicate check
- `resolver.ts` — builds the Anchor client, sends `resolve_market`, idempotency guard
- `keeper.ts` — event loop, settlement decisions, deadline sweeper
- `mockFeed.ts` — synthetic feed + proof for demos
- `index.ts` — entry point
