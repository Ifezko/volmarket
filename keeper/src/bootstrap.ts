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
// Fixed decimal odds implied by a market level (mirrors the frontend). p = level/100000 (the
// demargined probability the level encodes); Holds pays 1/p, Breaks pays 1/(1-p). p is clamped so
// odds stay in a sane band.
export function oddsFromLevel(level: number): { hold: number; break: number } {
  const p = Math.min(0.98, Math.max(0.02, level / 100000));
  return { hold: 1 / p, break: 1 / (1 - p) };
}

export async function bootstrapMarket(
  program: Program,
  keeper: Keypair,
  marketPubkey: PublicKey,
  marketAccount: { totalYes: BN | number; totalNo: BN | number; usdcMint: PublicKey; level: BN | number },
): Promise<string[]> {
  // Only markets on the canonical app mint — the keeper deposits app USDC, so a market on a
  // different mint would fail the deposit's mint constraint.
  if (marketAccount.usdcMint.toBase58() !== CONFIG.appUsdcMint.toBase58()) return [];

  const floor = CONFIG.bootstrapLiquidityUsdc;
  const cap = CONFIG.bootstrapMaxUsdc;
  if (floor <= 0) return [];

  const keeperUsdc = getAssociatedTokenAddressSync(CONFIG.appUsdcMint, keeper.publicKey);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), marketPubkey.toBuffer()], program.programId);

  const holdsUsdc = Number(marketAccount.totalYes) / 1e6;
  const breaksUsdc = Number(marketAccount.totalNo) / 1e6;
  const odds = oddsFromLevel(Number(marketAccount.level));

  const sigs: string[] = [];
  // House seeding: to pay the FILLED side its fixed odds O, seed the EMPTY (opposing) pool with
  // filledStake*(O-1) — then the contract's pro-rata claim pays filledStake*O. Seeding Holds
  // backs a Breaks bet (odds = break); seeding Breaks backs a Holds bet (odds = hold). Both empty
  // (no user stake) => the floor on each side. Capped at `cap` per pool.
  const seeds: { side: number; empty: boolean; filled: number; odds: number; label: string }[] = [
    { side: SIDE_YES, empty: holdsUsdc === 0, filled: breaksUsdc, odds: odds.break, label: "Holds" },
    { side: SIDE_NO, empty: breaksUsdc === 0, filled: holdsUsdc, odds: odds.hold, label: "Breaks" },
  ];
  for (const s of seeds) {
    if (!s.empty) continue; // pool already has liquidity — leave it
    const targetUsdc = Math.min(cap, s.filled > 0 ? s.filled * (s.odds - 1) : floor);
    const amount = Math.round(targetUsdc * 1e6);
    if (amount <= 0) continue;
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPubkey.toBuffer(), keeper.publicKey.toBuffer(), Buffer.from([s.side])],
      program.programId,
    );
    const sig: string = await (program.methods as any)
      .deposit(s.side, new BN(amount))
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
    log.info(`bootstrap: +${targetUsdc.toFixed(3)} USDC into ${s.label} pool of ${marketPubkey.toBase58()} (backs ${s.odds.toFixed(2)}x)`);
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
