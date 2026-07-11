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
  // Only markets on the canonical app mint — the keeper deposits app USDC, so a market on a
  // different mint would fail the deposit's mint constraint.
  if (marketAccount.usdcMint.toBase58() !== CONFIG.appUsdcMint.toBase58()) return [];

  const floor = CONFIG.bootstrapLiquidityUsdc;
  const cap = CONFIG.bootstrapMaxUsdc;
  const ratio = CONFIG.bootstrapRatio;
  if (floor <= 0) return [];

  const keeperUsdc = getAssociatedTokenAddressSync(CONFIG.appUsdcMint, keeper.publicKey);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), marketPubkey.toBuffer()], program.programId);

  const holdsUsdc = Number(marketAccount.totalYes) / 1e6;
  const breaksUsdc = Number(marketAccount.totalNo) / 1e6;

  const sigs: string[] = [];
  // For each EMPTY pool, seed an opposing stake sized to the filled (other) side × ratio, so the
  // payout multiplier is ~constant regardless of the user's stake. Clamp to [floor, cap]. If the
  // other side is also empty, fall back to the floor.
  const pools: { side: number; mine: number; other: number; label: string }[] = [
    { side: SIDE_YES, mine: holdsUsdc, other: breaksUsdc, label: "Holds" },
    { side: SIDE_NO, mine: breaksUsdc, other: holdsUsdc, label: "Breaks" },
  ];
  for (const p of pools) {
    if (p.mine > 0) continue; // pool already has liquidity — leave it
    const targetUsdc = p.other > 0 ? Math.min(cap, Math.max(floor, p.other * ratio)) : floor;
    const amount = Math.round(targetUsdc * 1e6);
    if (amount <= 0) continue;
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPubkey.toBuffer(), keeper.publicKey.toBuffer(), Buffer.from([p.side])],
      program.programId,
    );
    const sig: string = await (program.methods as any)
      .deposit(p.side, new BN(amount))
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
    log.info(`bootstrap: +${targetUsdc} USDC into ${p.label} pool of ${marketPubkey.toBase58()}`);
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
