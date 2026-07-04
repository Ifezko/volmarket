import { CONFIG, log } from "./config.js";
import { buildProgram } from "./resolver.js";
import { runKeeper } from "./keeper.js";
import { ensureActivated } from "./auth.js";

async function main() {
  log.info("Volmarket keeper starting");
  const { program, wallet } = buildProgram();
  if (!CONFIG.mock) {
    // real feed needs a live TxLINE session (guest JWT -> on-chain subscribe -> signed activate)
    await ensureActivated(wallet.payer);
  }
  await runKeeper(program);
  log.info("keeper running — watching for settling events");
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
