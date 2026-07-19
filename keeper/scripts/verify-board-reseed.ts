/**
 * Verifies the board-seeder re-opens a market after the previous one lapses — i.e. a fixture that is
 * still streaming stays on the live-only board without a keeper restart.
 *
 * The seeded map is keyed by EXPIRY, so:
 *   1st call            -> creates a market (reserved until windowEnd)
 *   immediate 2nd call  -> skipped, we still hold an open market
 *   after windowEnd     -> entry is stale, so a FRESH market is created for the same fixture/odd
 *
 * Run with a short window so the cycle takes seconds instead of hours:
 *   BOARD_MARKET_SECS=45 npx tsx scripts/verify-board-reseed.ts
 */
import { buildProgram } from "../src/resolver.js";
import { ensureBoardMarket } from "../src/boardSeeder.js";

const WINDOW = Number(process.env.BOARD_MARKET_SECS ?? 45);
const FIXTURE = Number(process.env.TEST_FIXTURE ?? 19_900_000 + Math.floor(Math.random() * 90_000));
const ODD_KEY = 0;
const PARAMS = 0;
const LEVEL = 42_000; // 42% ×1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { program, wallet, connection } = buildProgram();
  console.log(`fixture ${FIXTURE} odd ${ODD_KEY} · board window ${WINDOW}s`);

  const openMarkets = async () => {
    const all = await (program.account as any).market.all();
    return all
      .filter((a: any) => Number(a.account.fixtureId) === FIXTURE && Number(a.account.oddKey) === ODD_KEY)
      .map((a: any) => ({ addr: a.publicKey.toBase58(), end: Number(a.account.windowEnd) }));
  };

  const first = await ensureBoardMarket(program, wallet.payer, connection, FIXTURE, ODD_KEY, PARAMS, LEVEL);
  console.log(`1) first call            -> created=${first}  ${first ? "✅" : "❌ expected a new market"}`);

  const second = await ensureBoardMarket(program, wallet.payer, connection, FIXTURE, ODD_KEY, PARAMS, LEVEL);
  console.log(`2) immediate second call -> created=${second} ${second === false ? "✅ skipped (still open)" : "❌ duplicated"}`);

  console.log(`   waiting ${WINDOW + 5}s for the market to lapse…`);
  await sleep((WINDOW + 5) * 1000);

  const third = await ensureBoardMarket(program, wallet.payer, connection, FIXTURE, ODD_KEY, PARAMS, LEVEL);
  console.log(`3) after expiry          -> created=${third}  ${third ? "✅ fresh market re-opened" : "❌ fixture would fall off the board"}`);

  const markets = await openMarkets();
  console.log(`\nmarkets for this fixture/odd: ${markets.length}`);
  for (const m of markets) console.log(`   ${m.addr}  windowEnd ${new Date(m.end * 1000).toISOString()}`);
  const ok = first && second === false && third && markets.length >= 2;
  console.log(`\n${ok ? "PASS ✅ board re-seeds after expiry (no restart needed)" : "FAIL ❌"}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("ERR", e.message ?? e);
  process.exit(1);
});
