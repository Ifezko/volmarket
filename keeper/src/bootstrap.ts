import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN, type Program } from "@coral-xyz/anchor";
import { CONFIG, log } from "./config.js";

// Position.side pool selectors (mirror signal_markets/src/lib.rs).
const SIDE_YES = 1; // Holds pool (total_yes)
const SIDE_NO = 2; // Breaks pool (total_no)
const STATUS_OPEN = 0;

/**
 * Bootstrap liquidity for a single market: for each pool that is empty (0), the keeper deposits
 * CONFIG.bootstrapLiquidityUsdc from its own canonical-USDC wallet — so the market's losing side
 * is never zero and winners always have a real opposing pool to take winnings from. Idempotent:
 * a pool that already has stake is left alone, so repeated passes never double-seed. Returns the
 * signatures of any deposits made.
 */
export async function bootstrapMarket(
  program: Program,
  keeper: Keypair,
  marketPubkey: PublicKey,
  marketAccount: { totalYes: BN | number; totalNo: BN | number; usdcMint: PublicKey },
): Promise<string[]> {
  const amount = Math.round(CONFIG.bootstrapLiquidityUsdc * 1e6);
  if (amount <= 0) return [];
  // Only markets on the canonical app mint — the keeper deposits app USDC, so a market on a
  // different mint would fail the deposit's mint constraint.
  if (marketAccount.usdcMint.toBase58() !== CONFIG.appUsdcMint.toBase58()) return [];

  const keeperUsdc = getAssociatedTokenAddressSync(CONFIG.appUsdcMint, keeper.publicKey);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), marketPubkey.toBuffer()], program.programId);

  const sigs: string[] = [];
  const pools: [number, number, string][] = [
    [SIDE_YES, Number(marketAccount.totalYes), "Holds"],
    [SIDE_NO, Number(marketAccount.totalNo), "Breaks"],
  ];
  for (const [side, total, label] of pools) {
    if (total > 0) continue; // pool already has liquidity — leave it
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPubkey.toBuffer(), keeper.publicKey.toBuffer(), Buffer.from([side])],
      program.programId,
    );
    const sig: string = await (program.methods as any)
      .deposit(side, new BN(amount))
      .accounts({
        user: keeper.publicKey,
        market: marketPubkey,
        position,
        vault,
        userToken: keeperUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    sigs.push(sig);
    log.info(`bootstrap: +${CONFIG.bootstrapLiquidityUsdc} USDC into ${label} pool of ${marketPubkey.toBase58()}`);
  }
  return sigs;
}

/**
 * Scans all open markets and bootstraps any that has an empty pool. Best-effort: a failure on one
 * market (e.g. the keeper is out of USDC/gas) is logged and skipped so it never stops the keeper.
 * `connection` is accepted for symmetry with the rest of the keeper API (reads go through the
 * program's provider connection).
 */
export async function bootstrapOpenMarkets(program: Program, keeper: Keypair, _connection: Connection): Promise<void> {
  if (CONFIG.bootstrapLiquidityUsdc <= 0) return;
  let accts: { publicKey: PublicKey; account: any }[];
  try {
    accts = await (program.account as any).market.all();
  } catch (err) {
    log.warn("bootstrap: market scan failed, skipping this pass", String(err).slice(0, 120));
    return;
  }
  for (const { publicKey, account } of accts) {
    if (account.status !== STATUS_OPEN) continue;
    if (Number(account.totalYes) > 0 && Number(account.totalNo) > 0) continue; // both sides funded
    try {
      await bootstrapMarket(program, keeper, publicKey, account);
    } catch (err) {
      log.warn("bootstrap: failed for", publicKey.toBase58(), "-", String(err).slice(0, 120));
    }
  }
}
