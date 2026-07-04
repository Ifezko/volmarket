import fs from "node:fs";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";
import { STATUS_RESOLVED } from "./markets.js";
import type { ProofResult } from "./txline.js";

export function buildProgram(): { program: Program; wallet: Wallet; connection: Connection } {
  const secret = JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"));
  const keeper = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const wallet = new Wallet(keeper);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(CONFIG.idlPath, "utf8"));
  // Anchor 0.30: address is read from the IDL; ensure it matches PROGRAM_ID.
  const program = new Program(idl, provider);
  log.info("keeper wallet", keeper.publicKey.toBase58());
  return { program, wallet, connection };
}

/** Re-check on-chain status so we never double-submit a resolution. */
export async function isUnresolved(program: Program, market: PublicKey): Promise<boolean> {
  try {
    const acc: any = await (program.account as any).market.fetch(market);
    return acc.status !== STATUS_RESOLVED;
  } catch {
    return false;
  }
}

/**
 * Submit resolve_market. The program CPIs into TxLINE's validator with `proofBytes`
 * and the `accounts` from the proof (passed as remaining_accounts), then evaluates
 * the deterministic predicate over `value` to set the outcome.
 */
export async function resolveMarket(
  program: Program,
  market: PublicKey,
  proof: ProofResult
): Promise<string | null> {
  if (!(await isUnresolved(program, market))) {
    log.debug("already resolved, skipping", market.toBase58());
    return null;
  }
  try {
    const sig = await program.methods
      .resolveMarket(new BN(proof.value), Buffer.from(proof.proofBytes))
      .accounts({
        keeper: program.provider.publicKey,
        market,
        txlineProgram: CONFIG.txlineProgramId,
      })
      .remainingAccounts(
        proof.accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))
      )
      .rpc({ commitment: "confirmed" });
    log.info(`resolved ${market.toBase58()} value=${proof.value} tx=${sig}`);
    return sig;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("AlreadyResolved")) {
      log.debug("race: market resolved by another keeper", market.toBase58());
      return null;
    }
    log.error(`resolve failed ${market.toBase58()}:`, msg);
    return null;
  }
}
