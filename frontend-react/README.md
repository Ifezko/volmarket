# Volmarket - app

The Volmarket web app: the match board, per-odd signal terminal, and the deposit / predict / claim / group flows. React + Vite, with Privy embedded wallets and `@coral-xyz/anchor` for on-chain reads and writes against the `signal_markets` program on Solana devnet.

## Stack

- **React + Vite + TypeScript** - the UI and build.
- **Privy** (`@privy-io/react-auth`) - email/social login with an embedded Solana wallet; transactions are signed through Privy and sent via web3.js.
- **`@coral-xyz/anchor` + `@solana/web3.js`** - build instructions and read program accounts. The program IDL is committed at `src/idl/signal_markets.json`.

## Develop

```bash
npm install
npm run dev            # local dev server (Vite)
npm run build          # type-check + production build to dist/
npm run preview        # serve the built dist/ locally
```

Sensible devnet defaults are baked in, so `npm run dev` runs without any `.env`.

## Configuration

All config is via `VITE_*` env vars - client-side and non-secret (baked in at build time):

| Var | Purpose |
|---|---|
| `VITE_RPC_URL` | preferred Solana RPC (else Alchemy, else public devnet) |
| `VITE_ALCHEMY_RPC_URL` / `VITE_ALCHEMY_API_KEY` | Alchemy devnet RPC, used as a failover for the heavy account scans that the public RPC rate-limits |
| `VITE_USDC_MINT` | the app's USDC mint (defaults to the deployed devnet mint) |
| `VITE_PRIVY_APP_ID` | Privy application id |
| `VITE_FUND_ENDPOINT` | serverless faucet/fund endpoint for devnet USDC + gas |
| `VITE_FEE_RECIPIENT` | house wallet that receives the protocol fee on new markets |

## Layout

```
src/
├── idl/signal_markets.json     committed program IDL
├── lib/
│   ├── onchainMarkets.ts        RPC + program client, market account reads (with RPC failover)
│   ├── depositMarkets.ts        place predictions (create_market_v2 + deposit) and "send to group"
│   ├── claimMarkets.ts          wallet state, claimables, payout preview
│   ├── onchainGroups.ts         groups: fetch, create/join/approve/update/leave, group_deposit, activity, stats
│   ├── funds.ts                 USDC balance, deposit/withdraw, gas top-up
│   └── privyAnchorWallet.ts     bridges Privy's signer to Anchor's wallet interface
└── volmarket/                   UI - Board, MatchDetail, Slip, Groups view + detail, Profile, etc.
```

The board renders real on-chain `Market` accounts grouped into fixtures; the groups views render real `Group`/`GroupMember`/`GroupPosition` accounts. See the root `README.md` for the program's instruction surface and the settlement design.
