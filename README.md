# Volmarket

Non-custodial Solana prediction protocol where you trade the **volume signal** on every live football odd — predict whether a live odd **holds** support or **breaks** resistance within a chosen time window. Settled trustlessly against **TxLINE's** on-chain Merkle proofs. Built for the TxODDS World Cup Hackathon (Prediction Markets & Settlement track, deadline **2026-07-19**).

`volmarket.fun` · `@volmarketfun`

---

## What's in here

```
volmarket/
├── frontend/            Single-file prototype UI (open frontend/index.html in a browser)
├── signal_markets/      Anchor program — escrow, HOLD/BREAK markets, single-proof settlement
├── keeper/              TypeScript service — watches TxLINE, fetches proofs, resolves markets
├── mock_validator/      Native Solana program that approves any proof (devnet demo)
└── docs/
    ├── volmarket-technical-doc.md   Submission tech doc (core idea, settlement, endpoints, feedback)
    ├── signals-spec.md              How signals are calculated & verified (deep dive)
    ├── volmarket-revenue-model.md   Revenue one-pager (fee curve, on-ramp, unit economics)
    ├── volmarket-demo-script.md     5-minute demo video shooting script
    └── txodds-build-spec.md         Original full build spec
```

## The one-sentence architecture

TxLINE StablePrice odds (anchored on Solana) → `keeper` watches the feed and fetches the Merkle proof for the update that settles a market → calls `resolve_market` on the `signal_markets` Anchor program → which CPIs into the on-chain validator to verify the proof → winners `claim` pro-rata from a non-custodial escrow PDA.

## Core design rule (do not break)

**The line settles; volume only informs.** Internal stake is used to *display* the support/resistance profile and *suggest* a level — it never decides an outcome. Every settlement rides on TxLINE's anchored odds proof. This is what makes the market non-manipulable; keep the wall between "informs" and "settles" intact.

A market = `{ fixture, odd, side (HOLD|BREAK), level L, window [t0..t0+W] }`. L is snapped from the anchored StablePrice at t0 (support = current−δ, resistance = current+δ). **HOLD** wins if prob stays ≥ L for the window; **BREAK** wins if prob reaches ≥ L within it. Settlement is **single-proof**: submit the one anchored update that decides it (HOLD is optimistic / submit-to-disprove).

---

## Run it

**Frontend** — just open `frontend/index.html` in a browser. Self-contained (no build step). All data is mocked/simulated; live matches animate a synthetic tape, upcoming matches show a "markets open at kickoff" state.

**Anchor program** (`signal_markets/`)
```bash
cd signal_markets
anchor build
anchor deploy --provider.cluster devnet
```
Written for Anchor 0.30.1. `TXLINE_PROGRAM_ID` is a placeholder — set it before deploy.

**Mock validator** (`mock_validator/`) — deploy first for a devnet demo, then point the keeper and program at its program id (see `mock_validator/README.md`).

**Keeper** (`keeper/`)
```bash
cd keeper
npm install
cp .env.example .env   # fill in RPC, program ids, TxLINE creds
npm run mock           # fully-synthetic feed for a self-contained demo
npm run build && npm start   # real TxLINE feed (start runs the compiled dist/)
```

---

## ⚠️ Remaining seams to wire (this is the real build work)

**Authoritative source for everything below:** [github.com/txodds/tx-on-chain](https://github.com/txodds/tx-on-chain) — has the real IDL, program IDs, and working example scripts. Prefer it over `txline.txodds.com`'s doc pages where they conflict; that repo also revealed the real API host is **`oracle(.-dev).txodds.com`**, not `txline.txodds.com` (docs/marketing site) or `txline-dev.txodds.com` (a separate Swagger UI).

**Do this first:** `cd keeper && npm run check:worldcup` — runs `scripts/check-worldcup-coverage.ts`, which hits the real guest-JWT + snapshot endpoint with a few competition-ID guesses and tells you definitively whether World Cup data is actually served. This resolves a genuine three-way conflict in the sources: the `documentation/worldcup` page describes a "World Cup Free Tier" (Levels 1 & 12), but both `SoccerSupportedLeagues.csv` and the tx-on-chain repo's free-tier league list (9 named leagues, no World Cup) don't show it by name. The repo is dated ~Sept–Nov 2025 and likely predates World Cup coverage being added — but verify with a real API call before building further, not by re-reading docs.

Ordered by priority:

1. **Run the coverage check above.** If it comes back covered under guest-JWT-only (no wallet needed — `TXLINE_GUEST_ONLY=true`), your integration gets much simpler. If not, ask TxLINE support for the confirmed competition ID/param shape and re-run it.
2. **Fill the real `subscribe()` instruction** in `keeper/src/auth.ts` (`subscribeOnChain`) using the tx-on-chain repo's real IDL — don't guess the instruction layout, pull it from their `idl/` folder.
3. **Fill the `validate_with_txline` CPI** in `signal_markets/programs/signal_markets/src/lib.rs` by following `examples/validation/validate_odds_onchain.ts` in the tx-on-chain repo — it's a working reference for exactly this proof-verification flow. Until then, use `mock_validator`.
4. **Confirm activate() is GET or POST** — the tx-on-chain repo's example uses `GET /api/token/activate`; earlier doc pages implied `POST`. Confirm against whichever host you're actually targeting before shipping (`keeper/src/auth.ts`'s `activate()`).
5. ~~Confirm network support for Level 12~~ **CONFIRMED**: Level 12 (real-time World Cup) only exists on **devnet** right now, not mainnet (per TxLINE support on Discord). `CONFIG.network` already defaults to devnet — keep it there for real-time markets. Level 1 (60s-delayed) works on both networks.
6. **Confirm the `Prices[]` scale/units** (basis points vs probability×100) — also asked on Discord. `parseOddsValidation` in `keeper/src/txline.ts` currently treats it as a raw integer.
7. **Wire the real TxLINE SSE feed** into `normaliseStreamEvent` (`keeper/src/txline.ts`) against the actual stream payload shape, and replace the frontend's simulated tape with real StablePrice values.
8. **Production safeguards (design only for the hackathon — describe in the tech doc, don't build):** minimum-depth gate, per-wallet position caps, δ scaling. See the "Manipulation resistance" section in `docs/volmarket-technical-doc.md`.

Auth flow (`keeper/src/auth.ts`) supports two paths: **guest-JWT-only** (`TXLINE_GUEST_ONLY=true`) for leagues that don't require a subscription, and the full **on-chain subscribe → sign → activate** sequence for everything else. Real devnet/mainnet program IDs and token mints are wired into `config.ts` from the tx-on-chain repo.

## Submission checklist

- [x] Deployed/devnet-runnable prototype (frontend + program + keeper + mock validator)
- [x] Technical documentation (`docs/volmarket-technical-doc.md`)
- [x] Demo video **script** (`docs/volmarket-demo-script.md`) — record it; it's the heaviest-weighted criterion
- [ ] Public repo
- [ ] Recorded demo video (≤5 min)
- [ ] TxLINE API feedback (drafted in the tech doc's feedback section)

## Not legal or financial advice
Betting-adjacent product; regulatory treatment varies by jurisdiction. Frame revenue as protocol fees + data, and get counsel before charging in specific markets.
