// Demo claim on devnet: after the keeper resolved the market (npm run mock), the winning
// position claims its pro-rata payout. Prints the claim tx sig and the USDC balance delta.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CONFIG } from "../src/config.js";

const OUTCOME = { 0: "UNSET", 1: "YES", 2: "NO" } as const;

const secret = JSON.parse(readFileSync(CONFIG.keeperKeypair, "utf8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../signal_markets.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, provider);
const state = JSON.parse(readFileSync(new URL("../.demo-state.json", import.meta.url), "utf8"));

async function usdc(ata: PublicKey): Promise<number> {
  const b = await connection.getTokenAccountBalance(ata);
  return Number(b.value.amount) / 1e6;
}

async function main() {
  const market = new PublicKey(state.market);
  const vault = new PublicKey(state.vault);
  const ata = new PublicKey(state.ata);
  const side = state.winningPositionSide as number;

  const m: any = await (program.account as any).market.fetch(market);
  console.log("market:", market.toBase58());
  console.log("on-chain status:", m.status, "outcome:", OUTCOME[m.outcome as 0 | 1 | 2]);
  if (m.outcome !== side) throw new Error(`market outcome ${OUTCOME[m.outcome as 0|1|2]} != winning side ${OUTCOME[side as 0|1|2]} — did the keeper resolve yet?`);

  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), wallet.publicKey.toBuffer(), Buffer.from([side])],
    program.programId
  );

  const before = await usdc(ata);
  const claimSig = await program.methods
    .claim()
    .accounts({
      payer: wallet.publicKey, // permissionless claim (payer/owner split); here both are this wallet
      owner: wallet.publicKey,
      market,
      position,
      vault,
      userToken: ata,
      feeToken: ata, // fee recipient == market authority == this wallet
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const after = await usdc(ata);

  console.log("claim tx:", claimSig);
  console.log(`USDC balance ${before} -> ${after}  (+${(after - before).toFixed(6)} claimed on the winning ${OUTCOME[side as 0|1|2]} position)`);
  console.log("\nCLAIM_SIG=" + claimSig);
}

main().catch((e) => { console.error(e); process.exit(1); });
