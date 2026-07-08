import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { log } from "./config.js";
import { STATUS_RESOLVED } from "./markets.js";

// Position layout: discriminator(8) + market(32) -> the market pubkey starts at byte 8.
const POSITION_MARKET_OFFSET = 8;

/**
 * Autonomously pays out every winner on a resolved market. This is the second half of the
 * keeper's job: `resolveMarket` settles the outcome, then this pushes each winning position's
 * payout straight to the holder's wallet — no human, and no action needed from the winner.
 *
 * Permissionless by design (see the program's Claim accounts): the keeper signs as `payer`
 * only to cover fees; funds always route to the position `owner`'s token account, so the
 * keeper can never divert them. Winners can still self-claim as a fallback if the keeper is
 * down (the frontend keeps a hidden path for that).
 *
 * Idempotent: skips already-claimed positions and treats an `AlreadyClaimed` race (another
 * keeper, or the user self-claiming) as benign.
 */
export async function claimWinners(program: Program, market: PublicKey): Promise<void> {
  let m: any;
  try {
    m = await (program.account as any).market.fetch(market);
  } catch {
    return;
  }
  if (m.status !== STATUS_RESOLVED) return; // resolve failed or not ours to settle

  const outcome = m.outcome; // OUTCOME_YES(1) | OUTCOME_NO(2)
  const positions = await (program.account as any).position.all([
    { memcmp: { offset: POSITION_MARKET_OFFSET, bytes: market.toBase58() } },
  ]);

  const feeToken = getAssociatedTokenAddressSync(m.usdcMint, m.authority);
  const payer = program.provider.publicKey!;

  for (const { publicKey, account } of positions) {
    // a position wins iff the side it took matches the resolved outcome (YES=1, NO=2 on both).
    if (account.claimed || account.side !== outcome) continue;
    const owner: PublicKey = account.owner;
    const userToken = getAssociatedTokenAddressSync(m.usdcMint, owner);

    try {
      const sig = await program.methods
        .claim()
        // `as any`: runtime-loaded IDL collapses the accounts map to `never` (same as resolver.ts).
        .accounts({
          payer,
          owner,
          market,
          position: publicKey,
          vault: m.vault,
          userToken,
          feeToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        // the user_token ATA is created at deposit, but create it idempotently just in case so a
        // winner's payout can never be stuck behind a missing account (the keeper pays the rent).
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(payer, userToken, owner, m.usdcMint),
        ])
        .rpc({ commitment: "confirmed" });
      log.info(`claimed for ${owner.toBase58()} market=${market.toBase58()} tx=${sig}`);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("AlreadyClaimed")) {
        log.debug("already claimed (race)", publicKey.toBase58());
        continue;
      }
      log.error(`claim failed for ${owner.toBase58()} on ${market.toBase58()}:`, msg);
    }
  }
}
