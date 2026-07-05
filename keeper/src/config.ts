import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

// Real values confirmed from github.com/txodds/tx-on-chain (README, as of the repo's last update).
// NOTE: that repo is dated ~Sept-Nov 2025 and may predate World Cup coverage — see
// scripts/check-worldcup-coverage.ts, run it before trusting these for the hackathon build.
const NETWORK_DEFAULTS = {
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    txlineBaseUrl: "https://oracle-dev.txodds.com",
    txlineProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    tokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG", // confirmed devnet settlement mint
  },
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    txlineBaseUrl: "https://oracle.txodds.com",
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
  // NOTE: oracle(.-dev).txodds.com is the real API host per the tx-on-chain repo —
  // NOT txline.txodds.com (docs/marketing site) or txline-dev.txodds.com (separate Swagger UI).
  txlineBaseUrl: process.env.TXLINE_BASE_URL ?? netDefaults.txlineBaseUrl,
  txlineStreamUrl: process.env.TXLINE_STREAM_URL ?? `${netDefaults.txlineBaseUrl}/api/guest/odds/stream`,
  // Service level: 1 = World Cup free, 60s delay. 12 = World Cup + Int Friendlies, free, real-time.
  // (Per the older tx-on-chain README, the *no-subscription* guest free tier only lists 9 leagues
  //  — no World Cup by name. Run scripts/check-worldcup-coverage.ts to confirm before building on it.)
  // CONFIRMED (TxLINE, hackathon): on DEVNET during the hackathon, Level 1 is NOT downgraded —
  // it delivers real-time data (equivalent to mainnet Level 12), so sub-minute windows work on
  // devnet Level 1. This parity is a hackathon accommodation and likely won't persist afterward,
  // so don't rely on devnet Level 1 being real-time in production.
  serviceLevel: Number(process.env.TXLINE_SERVICE_LEVEL ?? 1),
  txlineApiKey: process.env.TXLINE_API_KEY ?? "", // populated at runtime by activate() if left blank
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  deadlineSweepMs: Number(process.env.DEADLINE_SWEEP_MS ?? 30000),
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
