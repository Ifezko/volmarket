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
const MARKET_SIDE_BREAK = 1;

describe("signal_markets — deterministic settlement core", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SignalMarkets as Program<SignalMarkets>;
  const authority = provider.wallet as anchor.Wallet;

  let usdcMint: PublicKey;
  const fixtureId = new anchor.BN(99001);
  const oddKey = new anchor.BN(1); // e.g. hash of (SuperOddsType, PriceName)
  const level = new anchor.BN(60000); // L = implied probability × 1000 (60000 = 60.000%), from TxLINE's Pct[]
  const windowStart = new anchor.BN(Math.floor(Date.now() / 1000) - 60);
  const windowEnd = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);

  // Two stakers: alice on YES (BREAK happens), bob on NO (it doesn't).
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
      [
        Buffer.from("market"),
        fixtureId.toArrayLike(Buffer, "le", 8),
        oddKey.toArrayLike(Buffer, "le", 8),
        Buffer.from([MARKET_SIDE_BREAK]),
        level.toArrayLike(Buffer, "le", 8),
        windowStart.toArrayLike(Buffer, "le", 8),
      ],
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

  it("creates a BREAK market over a single odd", async () => {
    await program.methods
      .createMarket(
        fixtureId,
        oddKey,
        MARKET_SIDE_BREAK,
        level,
        windowStart,
        windowEnd,
        500 // fee_bps = 5%
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
    assert.equal(m.side, MARKET_SIDE_BREAK);
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

  // NOTE: resolve_market CPIs into TXLINE_PROGRAM_ID. For local tests, deploy
  // mock_validator (accepts any proof) and point TXLINE_PROGRAM_ID at it before
  // building, or feature-gate the CPI. Then assert YES wins and alice claims
  // stake + pool - fee.
  it.skip("resolves via a crossing proof and pays the winner (needs mock_validator deployed)", async () => {});
});
