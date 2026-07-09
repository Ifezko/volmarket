import { readFileSync } from "node:fs";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { CONFIG, log } from "./config.js";

/**
 * Real TxLINE / TxODDS Oracle activation. Verified against the live OpenAPI spec
 * (https://txline-dev.txodds.com/docs/docs.yaml, v1.5.2) and the on-chain examples at
 * github.com/txodds/tx-on-chain (examples/devnet/common/users.ts).
 *
 * There is NO guest-JWT-only data path: EVERY data endpoint requires both
 * `Authorization: Bearer {jwt}` AND `X-Api-Token: {apiToken}` (spec security: httpAuth +
 * apiKeyAuth). A bare guest JWT returns 401 on the stream and snapshot endpoints. Even the
 * free World Cup tier must complete the full subscribe -> sign -> activate flow (subscribe just
 * charges 0 TxLINE). The old TXLINE_GUEST_ONLY mode below is therefore non-functional and kept
 * only as an explicit, documented opt-out — it will 401 on the first data call.
 *
 * The flow (per users.ts activateUser):
 *   1. POST /auth/guest/start          -> { token: jwt }                  (30-day guest session)
 *   2. On-chain: call `subscribe(serviceLevel, weeks)` on TxLINE's txoracle program -> txSig
 *      (pays in their SPL token for paid levels; free levels cost 0, but still require the tx)
 *   3. Sign the binding `${txSig}:${leagues.join(",")}:${jwt}` (nacl detached, base64) -> walletSignature
 *   4. POST /api/token/activate { txSig, walletSignature, leagues } with Authorization: Bearer {jwt}
 *      -> apiToken   (empty leagues [] = legacy/standard matrix, e.g. the free World Cup tier)
 *
 * Every subsequent data call sends BOTH the JWT (Authorization) and the apiToken (X-Api-Token).
 *
 * NOTE: this module assumes CONFIG.rpcUrl / CONFIG.network / CONFIG.txlineProgramId /
 * CONFIG.txlineBaseUrl are all pointed at the SAME network. The API host is
 * txline(-dev).txodds.com (the servers: block of the live spec).
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
    // NON-FUNCTIONAL against the live API: there is no guest-JWT-only data path — a bare guest
    // JWT 401s on every data endpoint (verified). Kept only as an explicit opt-out; the resulting
    // session will fail on the first data call. Use the full flow below instead.
    log.warn("TxLINE: guest-only mode is non-functional (data endpoints require X-Api-Token) — expect 401s");
    const jwt = await guestStart();
    session = { jwt, apiToken: jwt };
    return session;
  }

  log.info(`TxLINE: starting guest session (network=${CONFIG.network}, level=${CONFIG.serviceLevel}, leagues=[${CONFIG.leagues.join(",")}])`);
  const jwt = await guestStart();

  log.info("TxLINE: submitting on-chain subscribe()");
  const txSig = await subscribeOnChain(keeperKeypair, CONFIG.serviceLevel);
  log.info("TxLINE: subscribe tx", txSig);

  log.info("TxLINE: signing activation message");
  const signature = signActivation(keeperKeypair, txSig, CONFIG.leagues, jwt);

  log.info("TxLINE: activating API token");
  const apiToken = await activate(jwt, txSig, signature, CONFIG.leagues);

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
 * Calls `subscribe(serviceLevelId, weeks)` on TxLINE's on-chain txoracle program, Anchor-encoded
 * from the published IDL (CONFIG.txlineIdlPath). Modeled exactly on the reference flow in
 * github.com/txodds/tx-on-chain examples/devnet/common/users.ts:
 *   - args: service_level_id (u16), weeks (u8, positive multiple of 4)
 *   - accounts: user, pricing_matrix PDA (["pricing_matrix"]), token_mint, the user's Token-2022
 *     ATA, the treasury vault (ATA of token_treasury_pda), token_treasury_pda (["token_treasury_v2"]),
 *     and the token/ATA/system programs.
 * Free levels (e.g. World Cup) debit 0 TxLINE but still require the signed subscribe tx. The keeper's
 * Token-2022 ATA is created first if it doesn't exist yet.
 */
async function subscribeOnChain(keeper: Keypair, serviceLevelId: number): Promise<string> {
  const weeks = CONFIG.subscriptionWeeks;
  if (!Number.isInteger(weeks) || weeks < 4 || weeks % 4 !== 0) {
    throw new Error(`TXLINE_WEEKS must be a positive multiple of 4 (got ${weeks})`);
  }

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(CONFIG.txlineIdlPath, "utf8"));
  // Anchor 0.30 reads the program address from idl.address (the txoracle program).
  const program = new Program(idl, provider);

  const mint = CONFIG.txlineTokenMint;
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], program.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(mint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID);
  const userTokenAccount = getAssociatedTokenAddressSync(mint, keeper.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // subscribe() debits the user's Token-2022 ATA (0 for free tiers) — it must exist first.
  if (!(await connection.getAccountInfo(userTokenAccount))) {
    log.info("TxLINE: creating keeper Token-2022 ATA for the TxLINE mint");
    const createTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        keeper.publicKey, userTokenAccount, keeper.publicKey, mint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, createTx, [keeper], { commitment: "confirmed" });
  }

  log.info(`TxLINE: subscribe(level=${serviceLevelId}, weeks=${weeks})`);
  const sig: string = await (program.methods as any)
    .subscribe(serviceLevelId, weeks)
    .accounts({
      user: keeper.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: mint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return sig;
}

/**
 * The strict activation binding, exactly as the off-chain server verifies it
 * (github.com/txodds/tx-on-chain examples/devnet/common/users.ts):
 *   `${txSig}:${leagues.join(",")}:${jwt}`   (colon-delimited; empty leagues -> `txSig::jwt`)
 * Signed as a nacl detached signature over the UTF-8 bytes, then Base64-encoded. The `leagues`
 * here MUST be the same array sent to /api/token/activate, or the server rejects the activation.
 */
function signActivation(keeper: Keypair, txSig: string, leagues: number[], jwt: string): string {
  const message = new TextEncoder().encode(`${txSig}:${leagues.join(",")}:${jwt}`);
  const sig = nacl.sign.detached(message, keeper.secretKey);
  return Buffer.from(sig).toString("base64");
}

async function activate(jwt: string, txSig: string, walletSignature: string, leagues: number[]): Promise<string> {
  // ActivationPayload per the spec: { txSig, walletSignature, leagues:int[] }.
  const res = await fetch(`${CONFIG.txlineBaseUrl}/api/token/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  if (!res.ok) throw new Error(`token/activate failed: ${res.status} — ${await res.text()}`);
  // The spec documents a text/plain body (the raw token, e.g. "txoracle_api_123abc456def"), but
  // some deployments return JSON. Read text and accept either — mirrors users.ts (data.token || data).
  const body = (await res.text()).trim();
  let apiToken = body;
  try {
    const parsed = JSON.parse(body);
    apiToken = typeof parsed === "string" ? parsed : (parsed.apiToken ?? parsed.token ?? body);
  } catch {
    // plain-text token — use as-is
  }
  if (!apiToken) throw new Error("activate: no apiToken in response");
  return apiToken;
}
