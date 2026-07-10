import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

// API hosts confirmed from the live TxLINE OpenAPI spec (docs.yaml v1.5.2) at
// https://txline-dev.txodds.com/docs — the `servers:` block lists prod as txline.txodds.com
// and DevNet as txline-dev.txodds.com. The old github.com/txodds/tx-on-chain repo (the source
// of the earlier oracle*.txodds.com guess) was renamed to those two hosts ~2 months ago;
// oracle-dev.txodds.com no longer resolves. See scripts/check-worldcup-coverage.ts for coverage.
const NETWORK_DEFAULTS = {
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    txlineBaseUrl: "https://txline-dev.txodds.com",
    txlineProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    tokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG", // confirmed devnet settlement mint
  },
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    txlineBaseUrl: "https://txline.txodds.com",
    txlineProgramId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    tokenMint: "sLX1i9dfmsuyFBmJTWuGjjRmG4VPWYK6dRRKSM4BCSx",
  },
} as const;

const network = (process.env.TXLINE_NETWORK ?? "devnet") as "mainnet" | "devnet";
const netDefaults = NETWORK_DEFAULTS[network];

export const CONFIG = {
  // CONFIRMED (TxLINE support, Discord, via aidan): Level 12 (real-time World Cup) only
  // exists on DEVNET right now — not mainnet. Devnet is the correct network for real-time.
  network,
  rpcUrl: process.env.SOLANA_RPC_URL ?? netDefaults.rpcUrl,
  // Path to the keeper keypair file. Optional: on deployed hosts, set KEEPER_SECRET_KEY
  // (a JSON byte array) instead, which takes priority — see loadKeeperKeypair in resolver.ts.
  keeperKeypair: process.env.KEEPER_KEYPAIR ?? "",
  programId: new PublicKey(process.env.PROGRAM_ID ?? "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"), // your own signal_markets program
  // Self-contained IDL copied into keeper/ (see DEPLOY.md) so the keeper can be deployed
  // on its own without the signal_markets/ workspace present next to it.
  idlPath: process.env.IDL_PATH ?? "./signal_markets.idl.json",
  // TxLINE's own on-chain "txoracle" program — validate + subscribe CPI target.
  txlineProgramId: new PublicKey(process.env.TXLINE_PROGRAM_ID ?? netDefaults.txlineProgramId),
  txlineTokenMint: new PublicKey(process.env.TXLINE_TOKEN_MINT ?? netDefaults.tokenMint),
  // txline(-dev).txodds.com is the real API host (OpenAPI `servers:` block). The stream endpoint
  // is /api/odds/stream — it requires BOTH Authorization: Bearer <JWT> AND X-Api-Token headers
  // (security: httpAuth + apiKeyAuth). There is no guest-JWT-only data path; the only /api/guest/*
  // route in the spec is the purchase quote.
  txlineBaseUrl: process.env.TXLINE_BASE_URL ?? netDefaults.txlineBaseUrl,
  txlineStreamUrl: process.env.TXLINE_STREAM_URL ?? `${netDefaults.txlineBaseUrl}/api/odds/stream`,
  // Service level: 1 = World Cup free, 60s delay. 12 = World Cup + Int Friendlies, free, real-time.
  // (Per the older tx-on-chain README, the *no-subscription* guest free tier only lists 9 leagues
  //  — no World Cup by name. Run scripts/check-worldcup-coverage.ts to confirm before building on it.)
  // CONFIRMED (TxLINE, hackathon): on DEVNET during the hackathon, Level 1 is NOT downgraded —
  // it delivers real-time data (equivalent to mainnet Level 12), so sub-minute windows work on
  // devnet Level 1. This parity is a hackathon accommodation and likely won't persist afterward,
  // so don't rely on devnet Level 1 being real-time in production.
  serviceLevel: Number(process.env.TXLINE_SERVICE_LEVEL ?? 1),
  // Subscription duration in weeks for the on-chain subscribe() ix — must be a positive multiple
  // of 4 (the program rejects otherwise). 4 is the minimum; free tiers still cost 0 TxLINE.
  subscriptionWeeks: Number(process.env.TXLINE_WEEKS ?? 4),
  // TxLINE's own on-chain program IDL (examples/devnet/idl/txoracle.json from tx-on-chain),
  // copied into keeper/ so subscribe() can be Anchor-encoded without the examples workspace.
  txlineIdlPath: process.env.TXLINE_IDL_PATH ?? "./txoracle.idl.json",
  // Selected league IDs for /api/token/activate. Empty [] = legacy/standard-matrix subscription,
  // which is what the free World Cup tier uses (see the repo's subscription_free_tier.ts, which
  // passes []). Only a *custom* matrix subscription passes explicit league IDs (up to the purchased
  // limit). This array is signed into the activation binding AND sent as the `leagues` field — the
  // two MUST match. Override via TXLINE_LEAGUES="501,804,202".
  leagues: (process.env.TXLINE_LEAGUES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number),
  txlineApiKey: process.env.TXLINE_API_KEY ?? "", // populated at runtime by activate() if left blank
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  deadlineSweepMs: Number(process.env.DEADLINE_SWEEP_MS ?? 10000),
  // How often the watched-market set is refreshed. Kept short so a user's freshly-created
  // prediction — especially a short-window one — is picked up in time to be verified in-window
  // against the live signal, instead of only being caught by the post-window default sweep.
  marketRefreshMs: Number(process.env.MARKET_REFRESH_MS ?? 8000),
  // Bootstrap liquidity: when a market has an empty pool, the keeper seeds a small opposing stake
  // so no market ever has a zero-liquidity losing side (winners always have a real pool to win
  // from). Whole USDC on the canonical app mint; 0 disables. From its own funded devnet wallet.
  bootstrapLiquidityUsdc: Number(process.env.BOOTSTRAP_LIQUIDITY_USDC ?? 10),
  // Canonical app USDC mint (matches frontend-react USDC_MINT) — the mint the keeper deposits
  // bootstrap liquidity in; only markets on this mint are bootstrapped.
  appUsdcMint: new PublicKey(process.env.APP_USDC_MINT ?? "3aakQUJ6vvWphAr18ZoAJfoHs3w148tWJmKsgsnUj12q"),
  mock: process.argv.includes("--mock"),
};

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
const level = LEVELS[(process.env.LOG_LEVEL as keyof typeof LEVELS) ?? "info"];
const ts = () => new Date().toISOString().slice(11, 19);
export const log = {
  error: (...a: unknown[]) => level >= 0 && console.error(`${ts()} ERROR`, ...a),
  warn: (...a: unknown[]) => level >= 1 && console.warn(`${ts()} WARN `, ...a),
  info: (...a: unknown[]) => level >= 2 && console.log(`${ts()} INFO `, ...a),
  debug: (...a: unknown[]) => level >= 3 && console.log(`${ts()} DEBUG`, ...a),
};
