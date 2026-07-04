import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SignalMarkets } from "../target/types/signal_markets";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

// Side / status constants mirror the on-chain program.
const SIDE_YES = 1;
const SIDE_NO = 2;
const CMP_LTE = 0;

describe("signal_markets — deterministic settlement core", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SignalMarkets as Program<SignalMarkets>;
  const authority = provider.wallet as anchor.Wallet;

  let usdcMint: PublicKey;
  const marketId = new anchor.BN(1);
  const fixtureId = new anchor.BN(99001);

  // Two stakers: alice on YES, bob on NO.
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  let marketPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Mock USDC (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );

    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId
    );

    for (const kp of [alice, bob]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2e9);
      await provider.connection.confirmTransaction(sig);
    }
  });

  it("creates a market with a deterministic predicate", async () => {
    // Predicate: settling stat (e.g. home moneyline * 1000) <= 1500
    const predicate = {
      statKey: 1,
      comparator: CMP_LTE,
      value: new anchor.BN(1500),
      windowStart: new anchor.BN(0),
      windowEnd: new anchor.BN(0),
    };

    await program.methods
      .createMarket(
        marketId,
        fixtureId,
        1, // market_type: odds threshold
        0, // resolution_mode: deterministic
        predicate,
        500, // fee_bps = 5%
        new anchor.BN(Math.floor(Date.now() / 1000) + 86400),
        PublicKey.default // no group
      )
      .accounts({
        authority: authority.publicKey,
        market: marketPda,
        usdcMint,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.feeBps, 500);
    assert.equal(m.status, 0); // OPEN
  });

  it("takes deposits on both sides", async () => {
    for (const [kp, side, amount] of [
      [alice, SIDE_YES, 100_000_000], // 100 USDC
      [bob, SIDE_NO, 100_000_000],
    ] as [Keypair, number, number][]) {
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        usdcMint,
        kp.publicKey
      );
      await mintTo(
        provider.connection,
        authority.payer,
        usdcMint,
        ata.address,
        authority.publicKey,
        amount
      );

      const [positionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), marketPda.toBuffer(), kp.publicKey.toBuffer(), Buffer.from([side])],
        program.programId
      );

      await program.methods
        .deposit(side, new anchor.BN(amount))
        .accounts({
          user: kp.publicKey,
          market: marketPda,
          position: positionPda,
          vault: vaultPda,
          userToken: ata.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.totalYes.toNumber(), 100_000_000);
    assert.equal(m.totalNo.toNumber(), 100_000_000);
  });

  // NOTE: resolve_market CPIs into the real TxLINE validator. For local tests,
  // either (a) deploy a mock validator program at TXLINE_PROGRAM_ID that returns Ok,
  // or (b) feature-gate the CPI. Then assert YES wins and alice claims stake + pool - fee.
  it.skip("resolves via TxLINE proof and pays the winner (needs validator/mock)", async () => {});
});
