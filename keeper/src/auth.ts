import nacl from "tweetnacl";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { CONFIG, log } from "./config.js";

/**
 * Real TxLINE / TxODDS Oracle activation. Per github.com/txodds/tx-on-chain:
 *
 * PATH A — guest JWT only (no wallet, no on-chain tx):
 *   Their listed free-tier leagues serve snapshot/stream data off a guest JWT alone —
 *   no token purchase or subscribe() call needed. If World Cup coverage turns out to
 *   be JWT-gated the same way (unconfirmed — run scripts/check-worldcup-coverage.ts),
 *   you may not need PATH B at all for the hackathon demo.
 *
 * PATH B — on-chain subscribe (paid tiers / other competitions / Level 12 real-time —
 *   confirmed devnet-only right now, see CONFIG.network):
 *   1. POST /auth/guest/start          -> { jwt }                      (30-day guest session)
 *   2. On-chain: call `subscribe(serviceLevel)` on TxLINE's txoracle program -> txSig
 *      (pays in their SPL token for paid levels; Levels 1 & 12 are free — no cost, still on-chain)
 *   3. Sign a message binding { jwt, txSig } with the wallet keypair    -> signature
 *   4. GET/POST /api/token/activate { jwt, txSig, signature, publicKey } -> { apiToken }
 *      (the tx-on-chain repo shows GET; earlier docs pages showed POST — confirm which
 *       your CONFIG.txlineBaseUrl actually expects before shipping)
 *
 * Every subsequent data call sends BOTH:
 *   Authorization: Bearer {jwt}
 *   X-Api-Token: {apiToken}
 *
 * NOTE: this module assumes CONFIG.rpcUrl / CONFIG.network / CONFIG.txlineProgramId /
 * CONFIG.txlineBaseUrl are all pointed at the SAME network. Per the repo, the real API
 * host is oracle(.-dev).txodds.com — not txline.txodds.com or txline-dev.txodds.com.
 */

export interface TxLineSession {
  jwt: string;
  apiToken: string;
}

let session: TxLineSession | null = null;

export function authHeaders(): Record<string, string> {
  if (!session) throw new Error("TxLINE session not activated yet — call ensureActivated() first");
  return { Authorization: `Bearer ${session.jwt}`, "X-Api-Token": session.apiToken };
}

export async function ensureActivated(keeperKeypair: Keypair): Promise<TxLineSession> {
  if (session) return session;
  if (CONFIG.txlineApiKey) {
    // pre-provisioned token via env — skip the on-chain flow entirely
    session = { jwt: CONFIG.txlineApiKey, apiToken: CONFIG.txlineApiKey };
    return session;
  }
  if (process.env.TXLINE_GUEST_ONLY === "true") {
    // PATH A: some free-tier leagues serve data off a bare guest JWT, no wallet/tx involved.
    // Only use this if scripts/check-worldcup-coverage.ts confirms the competition you need
    // actually works this way — don't assume it does.
    log.info("TxLINE: guest-only mode (no on-chain subscribe)");
    const jwt = await guestStart();
    session = { jwt, apiToken: jwt };
    return session;
  }

  log.info(`TxLINE: starting guest session (network=${CONFIG.network}, level=${CONFIG.serviceLevel})`);
  const jwt = await guestStart();

  log.info("TxLINE: submitting on-chain subscribe()");
  const txSig = await subscribeOnChain(keeperKeypair, CONFIG.serviceLevel);

  log.info("TxLINE: signing activation message");
  const signature = signActivation(keeperKeypair, jwt, txSig);

  log.info("TxLINE: activating API token");
  const apiToken = await activate(jwt, txSig, signature, keeperKeypair.publicKey.toBase58());

  session = { jwt, apiToken };
  log.info("TxLINE: session activated");
  return session;
}

async function guestStart(): Promise<string> {
  const res = await fetch(`${CONFIG.txlineBaseUrl}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new Error(`guest/start failed: ${res.status}`);
  const json = await res.json();
  const jwt = json.jwt ?? json.token;
  if (!jwt) throw new Error("guest/start: no jwt in response");
  return jwt;
}

/**
 * Calls `subscribe(serviceLevel)` on TxLINE's on-chain program.
 * TODO: replace the raw instruction below with the real Anchor instruction
 * once TxLINE's IDL is pulled in — this is the same "fill the real instruction"
 * seam as validate_with_txline in signal_markets. Free levels (1, 12) should
 * cost no TxL, but still require a signed transaction to record the subscription.
 */
async function subscribeOnChain(keeper: Keypair, serviceLevel: number): Promise<string> {
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  // Placeholder instruction shape — swap for the real Anchor-encoded subscribe ix.
  // Discriminator + service level as a single u8 arg, matching a typical Anchor method.
  const data = Buffer.from([/* TODO: real 8-byte anchor discriminator for `subscribe` */ 0, 0, 0, 0, 0, 0, 0, 0, serviceLevel]);
  const ix = new TransactionInstruction({
    programId: CONFIG.txlineProgramId,
    keys: [
      { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
      // TODO: add the pricing-matrix PDA / treasury PDA accounts the real ix expects
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [keeper]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

function signActivation(keeper: Keypair, jwt: string, txSig: string): string {
  const message = new TextEncoder().encode(`${jwt}:${txSig}`);
  const sig = nacl.sign.detached(message, keeper.secretKey);
  return Buffer.from(sig).toString("base64");
}

async function activate(jwt: string, txSig: string, signature: string, publicKey: string): Promise<string> {
  const res = await fetch(`${CONFIG.txlineBaseUrl}/api/token/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, signature, publicKey }),
  });
  if (!res.ok) throw new Error(`token/activate failed: ${res.status} — ${await res.text()}`);
  const json = await res.json();
  const apiToken = json.apiToken ?? json.token;
  if (!apiToken) throw new Error("activate: no apiToken in response");
  return apiToken;
}
