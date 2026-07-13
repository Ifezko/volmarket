import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana'
import { getReadonlyProgram, withFailover } from './onchainMarkets'
import { PrivyAnchorWallet } from './privyAnchorWallet'
import { topUpGas } from './funds'

// mirror the on-chain u8 constants (signal_markets/programs/signal_markets/src/lib.rs)
const GROUP_PUBLIC = 0
const GROUP_PRIVATE = 1

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
