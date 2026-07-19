import { useEffect, useState } from 'react'
import type { ActivePosition } from '../lib/claimMarkets'
import type { FundingEvent } from '../lib/funds'
import { describeMarket, matchWindowLabel } from './liveFixtures'
import { feeLabel } from './groups'
import { getProfile, setProfile, resizeAvatar, avatarGradient } from '../lib/profileStore'

export interface MyGroup {
  address: string
  name: string
  feeBps: number
  role: 'Owner' | 'Member'
  members: number
}

// Rendered in the Slip drawer's `override` slot (same pattern as Deposit). Two views via a
// segmented control: "Account" (wallet address + withdraw) and "History" (recent on-chain
// transactions). The wallet address moved here out of the Nav. Withdraw and everything else
// sign silently via Privy, same as placing/depositing.
export function ProfilePanel({
  walletAddress,
  balance,
  accountLabel,
  onCopyAddress,
  onWithdraw,
  onLogout,
  positions,
  myGroups,
  onOpenGroups,
  onOpenGroup,
  loadFunding,
  onProfileSaved,
}: {
  walletAddress: string | undefined
  balance: number
  accountLabel: string | undefined
  onCopyAddress: (address: string) => void
  onWithdraw: (destination: string, amount: number) => Promise<void>
  onLogout: () => Promise<void>
  positions: ActivePosition[]
  myGroups: MyGroup[]
  onOpenGroups: () => void
  onOpenGroup: (address: string) => void
  loadFunding: () => Promise<FundingEvent[]>
  /** called after the user saves their username/avatar, so the nav avatar can refresh */
  onProfileSaved?: () => void
}) {
  const [view, setView] = useState<'account' | 'history'>('account')
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  // Profile (username + avatar), stored locally per wallet - see lib/profileStore.
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  useEffect(() => {
    const p = getProfile(walletAddress)
    setUsername(p.username ?? '')
    setAvatar(p.avatar ?? '')
  }, [walletAddress])

  function saveProfile() {
    if (!walletAddress) return
    setProfile(walletAddress, { username: username.trim() || undefined, avatar: avatar || undefined })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 1500)
    onProfileSaved?.()
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return
    setAvatarErr(null)
    try {
      setAvatar(await resizeAvatar(file))
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : String(err))
    }
  }

  // Deposits/withdrawals (predictions come from `positions`, already polled). Loaded lazily the
  // first time History opens, and after a withdrawal so the new debit shows up.
  const [funding, setFunding] = useState<FundingEvent[] | null>(null)
  const [fundingError, setFundingError] = useState<string | null>(null)

  useEffect(() => {
    if (view !== 'history' || funding !== null) return
    let cancelled = false
    setFundingError(null)
    loadFunding()
      .then((f) => !cancelled && setFunding(f))
      .catch((err) => !cancelled && setFundingError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [view, funding, loadFunding])

  const amt = Number(amount)
  const canWithdraw = !busy && destination.trim() !== '' && amt > 0 && amt <= balance

  function copy() {
    if (!walletAddress) return
    onCopyAddress(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  async function withdraw() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await onWithdraw(destination.trim(), amt)
      setDone(amt)
      setAmount('')
      setDestination('')
      setFunding(null) // reload so the new withdrawal appears in History
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  if (!walletAddress) {
    return <div className="empty">Sign in to view your profile.</div>
  }

  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={`segbtn${view === 'account' ? ' on' : ''}`} onClick={() => setView('account')}>
          Account
        </button>
        <button className={`segbtn${view === 'history' ? ' on' : ''}`} onClick={() => setView('history')}>
          History
        </button>
      </div>

      {view === 'account' ? (
        <>
          <div className="gfield">
            <label className="flbl">Profile</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
              <div
                className="pavatar"
                style={avatar ? { backgroundImage: `url(${avatar})` } : { background: avatarGradient(walletAddress) }}
              >
                {!avatar && (username || walletAddress || '?').slice(0, 1).toUpperCase()}
              </div>
              <input
                className="tinput"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                maxLength={20}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                {avatar ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => pickAvatar(e.target.files?.[0] ?? undefined)}
                  style={{ display: 'none' }}
                />
              </label>
              {avatar && (
                <button className="btn btn-ghost" onClick={() => setAvatar('')}>
                  Remove
                </button>
              )}
              <button className="btn btn-blue" onClick={saveProfile} style={{ marginLeft: 'auto' }}>
                {profileSaved ? 'Saved ✓' : 'Save profile'}
              </button>
            </div>
            {avatarErr && (
              <div className="s" style={{ color: 'var(--red)', marginTop: 6 }}>
                {avatarErr}
              </div>
            )}
          </div>

          {accountLabel && (
            <div className="gfield">
              <label className="flbl">Signed in as</label>
              <div className="l" style={{ wordBreak: 'break-all' }}>
                {accountLabel}
              </div>
            </div>
          )}

          <div className="gfield">
            <label className="flbl">Balance</label>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
              ${balance.toFixed(2)}
            </div>
          </div>

          <div className="gfield">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="flbl">My groups</label>
              <button
                className="s"
                onClick={onOpenGroups}
                style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0 }}
              >
                Browse all →
              </button>
            </div>
            {myGroups.length === 0 ? (
              <div className="s" style={{ color: 'var(--dim)' }}>
                You're not in any group yet. Open Groups to create or join one.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {myGroups.map((g) => (
                  <button
                    className="selrow"
                    key={g.address}
                    onClick={() => onOpenGroup(g.address)}
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="l">{g.name}</div>
                      <div className="s" style={{ color: 'var(--dim)' }}>
                        {g.role} · {g.members} {g.members === 1 ? 'member' : 'members'} · Group fee: {feeLabel(g.feeBps)}
                      </div>
                    </div>
                    <span className="s" style={{ color: 'var(--blue)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {g.role === 'Owner' ? 'Edit →' : 'View →'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gfield">
            <label className="flbl">Wallet address</label>
            <button
              className="selrow"
              onClick={copy}
              style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
              title="Copy address"
            >
              <div className="l mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>
                {walletAddress}
              </div>
              <span className="s" style={{ color: 'var(--blue)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
          </div>

          <div className="gfield">
            <label className="flbl">Withdraw USDC</label>
            <input
              className="tinput"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Destination Solana address"
              style={{ marginBottom: 8 }}
            />
            <input
              className="tinput"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder={`Amount (max ${balance.toFixed(2)})`}
            />
          </div>

          {error && (
            <div className="s" style={{ color: 'var(--red)', margin: '2px 0 10px' }}>
              {error}
            </div>
          )}
          {done != null && !error && (
            <div className="s" style={{ color: 'var(--green)', margin: '2px 0 10px' }}>
              Withdrew {done} USDC.
            </div>
          )}

          <button
            className="btn btn-blue"
            style={{ width: '100%', ...(canWithdraw ? {} : { opacity: 0.5 }) }}
            disabled={!canWithdraw}
            onClick={withdraw}
          >
            {busy ? 'Withdrawing…' : amt > balance ? 'Not enough balance' : `Withdraw${amt > 0 ? ` ${amt} USDC` : ''}`}
          </button>

          <div style={{ borderTop: '1px solid var(--border)', margin: '18px 0 0', paddingTop: 14 }}>
            <button
              className="btn"
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                ...(loggingOut ? { opacity: 0.5 } : {}),
              }}
              disabled={loggingOut}
              onClick={logout}
            >
              {loggingOut ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <HistoryList positions={positions} funding={funding} fundingError={fundingError} />
      )}
    </>
  )
}

// One row: left = title + subtitle, right = colored amount. Shared by predictions and
// deposits/withdrawals so every History entry reads the same.
function FeedRow({
  title,
  subtitle,
  subtitleColor,
  amount,
  amountColor,
  href,
  pending,
}: {
  title: string
  subtitle: string
  subtitleColor: string
  amount: string
  amountColor: string
  /** Solana Explorer target for this entry (tx for funding, market account for a prediction). */
  href?: string
  /** true while the prediction hasn't settled on-chain yet - the link is shown muted + inert. */
  pending?: boolean
}) {
  return (
    <div className="selrow" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <div className="l" style={{ fontSize: 13, lineHeight: 1.35 }}>
          {title}
        </div>
        <div className="s" style={{ color: 'var(--dim)', marginTop: 2 }}>
          <span style={{ color: subtitleColor, fontWeight: 600 }}>{subtitle}</span>
        </div>
        {pending ? (
          <span className="viewchain muted" title="Available once this prediction settles on-chain">
            View onchain ↗
          </span>
        ) : href ? (
          <a className="viewchain" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            View onchain ↗
          </a>
        ) : null}
      </div>
      <span className="s mono" style={{ color: amountColor, whiteSpace: 'nowrap', fontWeight: 700, marginLeft: 8 }}>
        {amount}
      </span>
    </div>
  )
}

type FeedEntry =
  | { kind: 'prediction'; key: string; time: number; pos: ActivePosition }
  | { kind: 'funding'; key: string; time: number; ev: FundingEvent }

// History = one chronological feed of everything that moved money: predictions (win/loss +
// payout/stake, from the polled position scan) and deposits/withdrawals (from the USDC-account
// scan). Newest first - predictions ordered by their settle time, funding by block time.
function HistoryList({
  positions,
  funding,
  fundingError,
}: {
  positions: ActivePosition[]
  funding: FundingEvent[] | null
  fundingError: string | null
}) {
  const entries: FeedEntry[] = [
    ...positions.map(
      (p): FeedEntry => ({ kind: 'prediction', key: p.position.toBase58(), time: p.windowEnd, pos: p }),
    ),
    ...(funding ?? []).map(
      (ev): FeedEntry => ({ kind: 'funding', key: ev.signature, time: ev.blockTime ?? 0, ev }),
    ),
  ].sort((a, b) => b.time - a.time)

  if (entries.length === 0 && funding !== null) {
    return <div className="empty">No activity yet - deposit, then pick a window and place a prediction.</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {entries.map((entry) => {
        if (entry.kind === 'prediction') {
          const p = entry.pos
          const won = p.status === 'won'
          const lost = p.status === 'lost'
          const color = won ? 'var(--green)' : lost ? 'var(--red)' : 'var(--dim)'
          return (
            <FeedRow
              key={entry.key}
              title={`${describeMarket(p.fixtureId, p.oddKey, p.marketParams, p.side, p.level)} · ${matchWindowLabel(p.fixtureId, p.windowStart, p.windowEnd)}`}
              subtitle={`${won ? 'WON' : lost ? 'LOST' : 'PENDING'} · ${new Date(p.windowEnd * 1000).toLocaleString()}`}
              subtitleColor={color}
              amount={won ? `+${p.payoutUsdc.toFixed(2)}` : lost ? `−${p.stakeUsdc.toFixed(2)}` : p.stakeUsdc.toFixed(2)}
              amountColor={color}
              // The market account carries the outcome + the resolve transaction, so it's the entry
              // point for tracing a settled prediction. Muted until it settles - there's nothing
              // resolved to inspect while the proof is still pending.
              href={`https://explorer.solana.com/address/${p.market.toBase58()}?cluster=devnet`}
              pending={p.status === 'pending'}
            />
          )
        }
        const ev = entry.ev
        const isDeposit = ev.kind === 'deposit'
        const when = ev.blockTime ? new Date(ev.blockTime * 1000).toLocaleString() : 'pending'
        return (
          <FeedRow
            key={entry.key}
            title={isDeposit ? 'Deposit' : 'Withdrawal'}
            subtitle={`${isDeposit ? 'DEPOSIT' : 'WITHDRAW'} · ${when}`}
            subtitleColor="var(--dim)"
            amount={`${isDeposit ? '+' : '−'}${ev.amountUsdc.toFixed(2)}`}
            amountColor={isDeposit ? 'var(--green)' : 'var(--text)'}
            // Funding entries ARE a confirmed transaction, so link straight to it.
            href={`https://explorer.solana.com/tx/${ev.signature}?cluster=devnet`}
            pending={!ev.blockTime}
          />
        )
      })}

      {funding === null && !fundingError && (
        <div className="s" style={{ color: 'var(--dim)', padding: '4px 2px' }}>
          Loading deposits & withdrawals…
        </div>
      )}
      {fundingError && (
        <div className="s" style={{ color: 'var(--dim)', padding: '4px 2px' }}>
          Couldn't load deposits/withdrawals.
        </div>
      )}
    </div>
  )
}
