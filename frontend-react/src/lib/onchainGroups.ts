import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram, withFailover, fetchRealMarkets, type RealMarket } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'
import { topUpGas, USDC_MINT } from './funds'

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
const GROUP_PUBLIC = 0
const GROUP_PRIVATE = 1
const SIDE_YES = 1 // "hold" pool
const SIDE_NO = 2 // "break" pool

type PrivySignTransaction = ConstructorParameters<typeof PrivyAnchorWallet>[1]

export interface OnchainGroup {
  address: string
  owner: string
  groupId: string // u64 as decimal string (exceeds JS number range)
  name: string
  feeBps: number
  visibility: 'Public' | 'Private'
  roster: boolean
  memberCount: number
}

export interface OnchainMember {
  address: string
  group: string
  member: string
  approved: boolean
}

// "Group fee: 2.5%" / "Group fee: Free" — the on-chain fee_bps rendered for every group screen.
export function feeLabel(feeBps: number): string {
  return feeBps === 0 ? 'Free' : `${(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2)}%`
}

function groupPda(owner: PublicKey, groupId: BN, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('group'), owner.toBuffer(), groupId.toArrayLike(Buffer, 'le', 8)],
    programId,
  )[0]
}

function memberPda(group: PublicKey, member: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('member'), group.toBuffer(), member.toBuffer()],
    programId,
  )[0]
}

/** Reads all Group + GroupMember accounts on the program (one scan each, via the RPC failover). */
export async function fetchGroups(
  connection: Connection,
): Promise<{ groups: OnchainGroup[]; members: OnchainMember[] }> {
  const [rawGroups, rawMembers] = await withFailover(connection, async (program) => {
    const g = await (program.account as any).group.all()
    const m = await (program.account as any).groupMember.all()
    return [g, m] as const
  })

  const groups: OnchainGroup[] = rawGroups.map(({ publicKey, account }: any) => ({
    address: publicKey.toBase58(),
    owner: account.owner.toBase58(),
    groupId: account.groupId.toString(),
    name: account.name,
    feeBps: account.feeBps,
    visibility: account.visibility === GROUP_PRIVATE ? 'Private' : 'Public',
    roster: account.roster,
    memberCount: account.memberCount,
  }))

  const members: OnchainMember[] = rawMembers.map(({ publicKey, account }: any) => ({
    address: publicKey.toBase58(),
    group: account.group.toBase58(),
    member: account.member.toBase58(),
    approved: account.approved,
  }))

  return { groups, members }
}

// --- writes (signed by the Privy wallet, same pattern as depositMarkets) ---

async function signSend(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  build: (program: ReturnType<typeof getReadonlyProgram>, owner: PublicKey) => Promise<Transaction>,
): Promise<string> {
  const owner = new PublicKey(wallet.address)
  await topUpGas(wallet.address).catch(() => {}) // best-effort gas for the new rent-exempt account
  const program = getReadonlyProgram(connection)
  const tx = await build(program, owner)
  tx.feePayer = owner
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  const signed = await new PrivyAnchorWallet(wallet, sign).signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

/** Creates a group owned by the wallet. `feeBps` is the group's cut (0 = "Free"). */
export async function createGroupOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  opts: { name: string; feeBps: number; visibility: 'Public' | 'Private'; roster: boolean },
): Promise<{ signature: string; group: string }> {
  const owner = new PublicKey(wallet.address)
  const program = getReadonlyProgram(connection)
  const groupId = new BN(Date.now())
  const group = groupPda(owner, groupId, program.programId)
  const signature = await signSend(connection, wallet, sign, async (prog) => {
    const ix = await (prog.methods as any)
      .createGroup(
        groupId,
        opts.name,
        opts.feeBps,
        opts.visibility === 'Private' ? GROUP_PRIVATE : GROUP_PUBLIC,
        opts.roster,
      )
      .accounts({ owner, group, systemProgram: SystemProgram.programId })
      .instruction()
    return new Transaction().add(ix)
  })
  return { signature, group: group.toBase58() }
}

/** The wallet requests to join a group (mints a pending GroupMember). */
export async function requestJoinOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  groupAddress: string,
): Promise<string> {
  const member = new PublicKey(wallet.address)
  const group = new PublicKey(groupAddress)
  return signSend(connection, wallet, sign, async (program) => {
    const gm = memberPda(group, member, program.programId)
    const ix = await (program.methods as any)
      .requestJoin()
      .accounts({ member, group, groupMember: gm, systemProgram: SystemProgram.programId })
      .instruction()
    return new Transaction().add(ix)
  })
}

// ---- activity feed ----

export interface GroupActivityItem {
  /** GroupPosition account address — stable key for the feed row */
  address: string
  group: string
  member: string
  market: string
  side: 'hold' | 'break'
  amountUsdc: number
  // the market this call was on, for display + "Join this call" prefill
  fixtureId: number
  oddKey: number
  marketParams: number
  /** implied probability (%) — the market level */
  level: number
  windowStart: number
  windowEnd: number
  status: 'open' | 'resolved'
  outcome: 'unset' | 'yes' | 'no'
  /** final pool sizes on the market (USDC) — for pro-rata PnL of settled calls */
  marketTotalYes: number
  marketTotalNo: number
}

export interface GroupStats {
  /** number of group calls (GroupPositions) */
  preds: number
  /** net PnL across settled calls (USDC), fee-adjusted like claim_group */
  pnl: number
  /** win rate over settled calls (0–100) */
  wr: number
}

// Live group stats from its calls + each call's market outcome — the card's Predictions / PnL /
// Win rate. A settled winning call nets its pro-rata share of the losing pool minus the group fee;
// a settled loser is -stake; open calls don't count toward PnL/WR yet. Mirrors claim_group math.
export function groupStats(items: GroupActivityItem[], feeBps: number): GroupStats {
  let pnl = 0
  let wins = 0
  let settled = 0
  for (const it of items) {
    if (it.status !== 'resolved' || it.outcome === 'unset') continue
    settled++
    const won = (it.side === 'hold' && it.outcome === 'yes') || (it.side === 'break' && it.outcome === 'no')
    if (won) {
      const winTotal = it.side === 'hold' ? it.marketTotalYes : it.marketTotalNo
      const loseTotal = it.side === 'hold' ? it.marketTotalNo : it.marketTotalYes
      const winnings = winTotal > 0 ? (it.amountUsdc * loseTotal) / winTotal : 0
      pnl += winnings - (winnings * feeBps) / 10_000
      wins++
    } else {
      pnl -= it.amountUsdc
    }
  }
  return { preds: items.length, pnl: Math.round(pnl * 100) / 100, wr: settled ? Math.round((wins / settled) * 100) : 0 }
}

/**
 * Recent group calls: every GroupPosition (a member's group_deposit into a market), joined to its
 * market for display + prefill. Filtered to the canonical USDC mint (same as the board) so stray
 * throwaway-mint test markets don't leak in. Sorted with open markets first, largest stake first —
 * a "what's live to join" ordering, since GroupPosition carries no timestamp.
 */
export async function fetchGroupActivity(connection: Connection): Promise<GroupActivityItem[]> {
  const [rawPositions, markets] = await withFailover(connection, async (program) => {
    const gp = await (program.account as any).groupPosition.all()
    return [gp, null] as const
  }).then(async ([gp]) => [gp, await fetchRealMarkets(connection)] as const)

  const byAddr = new Map<string, RealMarket>(markets.map((m) => [m.address.toBase58(), m]))
  const items: GroupActivityItem[] = []
  for (const { publicKey, account } of rawPositions as any[]) {
    const marketAddr = account.market.toBase58()
    const m = byAddr.get(marketAddr)
    if (!m || !m.usdcMint.equals(USDC_MINT)) continue // skip unknown / non-app-mint markets
    items.push({
      address: publicKey.toBase58(),
      group: account.group.toBase58(),
      member: account.member.toBase58(),
      market: marketAddr,
      side: account.side === SIDE_NO ? 'break' : 'hold',
      amountUsdc: Number(account.amount) / 1e6,
      fixtureId: m.fixtureId,
      oddKey: m.oddKey,
      marketParams: m.marketParams,
      level: m.level,
      windowStart: m.windowStart,
      windowEnd: m.windowEnd,
      status: m.status,
      outcome: m.outcome,
      marketTotalYes: m.totalYes,
      marketTotalNo: m.totalNo,
    })
  }
  items.sort((a, b) => (a.status === b.status ? b.amountUsdc - a.amountUsdc : a.status === 'open' ? -1 : 1))
  return items
}

/**
 * "Join this call" / "Send to group": the signer's own group_deposit into an existing market as
 * part of `group`. The market must already exist (feed items always reference an open market);
 * funds land in the shared GroupPool + the member's GroupPosition. Requires an approved membership
 * (enforced on-chain). Mirrors depositMarkets' sign/send.
 */
export async function groupDepositOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  opts: { group: string; market: string; side: 'hold' | 'break'; amountUsdc: number },
): Promise<string> {
  const member = new PublicKey(wallet.address)
  const group = new PublicKey(opts.group)
  const market = new PublicKey(opts.market)
  const depositSide = opts.side === 'hold' ? SIDE_YES : SIDE_NO
  return signSend(connection, wallet, sign, async (program) => {
    const pid = program.programId
    // The group owner has no GroupMember account and passes null (allowed on-chain); everyone else
    // passes their approved membership. Check existence so either path works.
    const groupMemberKey = memberPda(group, member, pid)
    const groupMember = (await connection.getAccountInfo(groupMemberKey)) ? groupMemberKey : null
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], pid)
    const [groupPool] = PublicKey.findProgramAddressSync([Buffer.from('grouppool'), group.toBuffer(), market.toBuffer()], pid)
    const [groupPosition] = PublicKey.findProgramAddressSync(
      [Buffer.from('grouppos'), group.toBuffer(), market.toBuffer(), member.toBuffer(), Buffer.from([depositSide])],
      pid,
    )
    const memberToken = getAssociatedTokenAddressSync(USDC_MINT, member)
    const tx = new Transaction()
    // ensure the member's USDC ATA exists (idempotent) so the deposit never fails on a missing ATA
    tx.add(createAssociatedTokenAccountIdempotentInstruction(member, memberToken, member, USDC_MINT))
    const ix = await (program.methods as any)
      .groupDeposit(depositSide, new BN(Math.round(opts.amountUsdc * 1e6)))
      .accounts({
        member,
        group,
        groupMember,
        market,
        groupPool,
        groupPosition,
        vault,
        memberToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
    tx.add(ix)
    return tx
  })
}

/** The owner edits their group's settings (name, fee, visibility, roster). */
export async function updateGroupOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  groupAddress: string,
  opts: { name: string; feeBps: number; visibility: 'Public' | 'Private'; roster: boolean },
): Promise<string> {
  const owner = new PublicKey(wallet.address)
  const group = new PublicKey(groupAddress)
  return signSend(connection, wallet, sign, async (program) => {
    const ix = await (program.methods as any)
      .updateGroup(
        opts.name,
        opts.feeBps,
        opts.visibility === 'Private' ? GROUP_PRIVATE : GROUP_PUBLIC,
        opts.roster,
      )
      .accounts({ owner, group })
      .instruction()
    return new Transaction().add(ix)
  })
}

/** A member leaves a group (closes their GroupMember; owner can't leave). */
export async function leaveGroupOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  groupAddress: string,
): Promise<string> {
  const member = new PublicKey(wallet.address)
  const group = new PublicKey(groupAddress)
  return signSend(connection, wallet, sign, async (program) => {
    const gm = memberPda(group, member, program.programId)
    const ix = await (program.methods as any)
      .leaveGroup()
      .accounts({ member, group, groupMember: gm })
      .instruction()
    return new Transaction().add(ix)
  })
}

/** The group owner approves a pending member (approved false -> true). */
export async function approveMemberOnchain(
  connection: Connection,
  wallet: ConnectedStandardSolanaWallet,
  sign: PrivySignTransaction,
  groupAddress: string,
  memberAddress: string,
): Promise<string> {
  const owner = new PublicKey(wallet.address)
  const group = new PublicKey(groupAddress)
  const memberKey = new PublicKey(memberAddress)
  return signSend(connection, wallet, sign, async (program) => {
    const gm = memberPda(group, memberKey, program.programId)
    const ix = await (program.methods as any)
      .approveMember()
      .accounts({ owner, group, groupMember: gm })
      .instruction()
    return new Transaction().add(ix)
  })
}
