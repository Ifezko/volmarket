use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("86hERt8cdRZUBpc1Ng8coX2jwLmWGUcyc9JNfspw39yr");

// CPI target for proof validation. On devnet this points at our deployed `mock_validator`
// (approves any proof — demo only). This is the ACTIVE demo path. The real txoracle
// `validate_odds` CPI (TXLINE_VALIDATOR_ID + cpi_validate_odds, below) is implemented but
// selected only when the keeper passes the real validator program instead of this one.
// https://txline-docs.txodds.com/documentation/programs/addresses
pub const TXLINE_PROGRAM_ID: Pubkey = anchor_lang::pubkey!("FPnwSSp2DXcNvJnxXWc2JXvU4MLNfrWDT6wBcU5Eptse");

// The REAL TxLINE on-chain validator ("txoracle") — the CPI target for genuine Merkle-proof
// validation via its `validate_odds` instruction (see cpi_validate_odds).
//
// VERIFIED ON DEVNET. A genuine TxLINE odds Merkle proof has been verified through this CPI:
//   tx 5vPAbG89XBZkWTFw82HFEDjZDKbK6nFr9qqhPMztfG2Qobt2GpCeBDeFrwcVHmvsno3soZmEE4aniaswhj16uML2
//   (txoracle logs: "Stage 1 SUCCESS" snapshot->summary, "Stage 2 SUCCESS" summary->main root)
// The earlier `/api/odds/validation` 404s were EPOCH TIMING, not a bad messageId: proofs publish in
// wall-clock 5-minute batches, so a record is only provable shortly after its interval closes (see
// fetchPublishedOddsProof in keeper/src/txline.ts).
// `TXLINE_PROGRAM_ID` (mock) remains the ACTIVE demo path; this real path is selected only when the
// keeper passes TXLINE_VALIDATOR_ID as `txline_program`.
pub const TXLINE_VALIDATOR_ID: Pubkey = anchor_lang::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

// Anchor global-instruction discriminator for txoracle `validate_odds`, copied verbatim from its
// IDL (= sha256("global:validate_odds")[..8]).
const VALIDATE_ODDS_DISCRIMINATOR: [u8; 8] = [192, 19, 91, 138, 104, 100, 212, 86];

pub const BPS_DENOMINATOR: u64 = 10_000;

// Market.side — which predicate this market resolves. Fixed at creation.
pub const MARKET_SIDE_HOLD: u8 = 0;
pub const MARKET_SIDE_BREAK: u8 = 1;

// Position.side — which pool a deposit backs: that the market's declared
// predicate comes true (YES) or doesn't (NO).
pub const SIDE_YES: u8 = 1;
pub const SIDE_NO: u8 = 2;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_RESOLVED: u8 = 1;

pub const OUTCOME_UNSET: u8 = 0;
pub const OUTCOME_YES: u8 = 1;
pub const OUTCOME_NO: u8 = 2;

#[program]
pub mod signal_markets {
    use super::*;

    /// Opens a market over a single TxLINE-settleable odd and inits its USDC vault PDA.
    /// `level` is the L snapped from TxLINE's anchored StablePrice at market open
    /// (support = current - delta for a HOLD market, resistance = current + delta for BREAK).
    /// L is on the same scale as the values submitted to `resolve_market`: TxLINE's demargined
    /// implied probability × 1000 (a 3-decimal percent as an integer, e.g. 39.432% -> 39432),
    /// so the crossing comparison is apples-to-apples. This program stays scale-agnostic — the
    /// keeper is responsible for supplying L and the resolving value on this shared scale.
    ///
    /// A market's identity is (fixture, odd, params, side, level, window_start). `odd_key`
    /// selects the SuperOddsType + outcome (e.g. 1X2 home, Over/Under over); `market_params`
    /// carries the SuperOddsType's parameters so different lines are distinct markets — for
    /// Over/Under it's the goal line × 100 (1.5 -> 150, 2.5 -> 250); 0 when there is no line
    /// (e.g. 1X2). The keeper matches a TxLINE odds record to a market by SuperOddsType AND
    /// MarketParameters, so these must line up with what it derives from the feed.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: u64,
        odd_key: u64,
        market_params: u64,
        side: u8,
        level: i64,
        window_start: i64,
        window_end: i64,
        fee_bps: u16,
    ) -> Result<()> {
        require!(
            side == MARKET_SIDE_HOLD || side == MARKET_SIDE_BREAK,
            MarketError::InvalidMarketSide
        );
        require!(window_end > window_start, MarketError::InvalidWindow);
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);

        let m = &mut ctx.accounts.market;
        m.fixture_id = fixture_id;
        m.odd_key = odd_key;
        m.market_params = market_params;
        m.side = side;
        m.level = level;
        m.window_start = window_start;
        m.window_end = window_end;
        m.usdc_mint = ctx.accounts.usdc_mint.key();
        m.vault = ctx.accounts.vault.key();
        // Original behaviour: the market creator (signer) is the authority, so the protocol
        // fee on claim washes back to them. `create_market_v2` routes fees to a dedicated
        // house wallet instead. This 8-arg form is preserved unchanged for the callers
        // (prod/hotfix, keeper seed scripts) that already build 8-arg instruction data.
        m.authority = ctx.accounts.authority.key();
        m.fee_bps = fee_bps;
        m.status = STATUS_OPEN;
        m.outcome = OUTCOME_UNSET;
        m.total_yes = 0;
        m.total_no = 0;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Same as `create_market`, plus an explicit `fee_recipient`: where the protocol fee is
    /// paid on claim. Stored into `market.authority`, which the Claim ix constrains
    /// `fee_token.owner` against. Passed as data (NOT a signer/account) so the market creator —
    /// user or keeper — can direct fees to a dedicated house wallet without that wallet
    /// co-signing or paying rent. The signer/rent-payer stays the `authority` account.
    ///
    /// Added as a NEW instruction alongside the unchanged 8-arg `create_market` so both wire
    /// formats coexist on the live program: legacy 8-arg callers keep working, while the
    /// fee-routing frontend calls this. The account layout and `CreateMarket` context are
    /// identical, so markets from either path stay mutually readable.
    pub fn create_market_v2(
        ctx: Context<CreateMarket>,
        fixture_id: u64,
        odd_key: u64,
        market_params: u64,
        side: u8,
        level: i64,
        window_start: i64,
        window_end: i64,
        fee_bps: u16,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        require!(
            side == MARKET_SIDE_HOLD || side == MARKET_SIDE_BREAK,
            MarketError::InvalidMarketSide
        );
        require!(window_end > window_start, MarketError::InvalidWindow);
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);

        let m = &mut ctx.accounts.market;
        m.fixture_id = fixture_id;
        m.odd_key = odd_key;
        m.market_params = market_params;
        m.side = side;
        m.level = level;
        m.window_start = window_start;
        m.window_end = window_end;
        m.usdc_mint = ctx.accounts.usdc_mint.key();
        m.vault = ctx.accounts.vault.key();
        // The fee recipient (see the `fee_recipient` arg) — NOT necessarily the creator.
        m.authority = fee_recipient;
        m.fee_bps = fee_bps;
        m.status = STATUS_OPEN;
        m.outcome = OUTCOME_UNSET;
        m.total_yes = 0;
        m.total_no = 0;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Stakes USDC into the vault on YES (the market's declared HOLD/BREAK predicate
    /// comes true) or NO (it doesn't). Volume only informs the displayed profile —
    /// it never settles the market.
    pub fn deposit(ctx: Context<Deposit>, side: u8, amount: u64) -> Result<()> {
        require!(side == SIDE_YES || side == SIDE_NO, MarketError::InvalidSide);
        require!(amount > 0, MarketError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let pos = &mut ctx.accounts.position;
        pos.market = ctx.accounts.market.key();
        pos.owner = ctx.accounts.user.key();
        pos.side = side;
        pos.amount = pos.amount.checked_add(amount).ok_or(MarketError::Overflow)?;
        pos.claimed = false;
        pos.bump = ctx.bumps.position;

        let m = &mut ctx.accounts.market;
        if side == SIDE_YES {
            m.total_yes = m.total_yes.checked_add(amount).ok_or(MarketError::Overflow)?;
        } else {
            m.total_no = m.total_no.checked_add(amount).ok_or(MarketError::Overflow)?;
        }
        Ok(())
    }

    /// Permissionless single-proof settlement — the deterministic core of the protocol.
    ///
    /// SCALE: `value` and the market's level `L` carry the SAME units — demargined implied
    /// PROBABILITY × 1000 (e.g. 46.2% → 46_200), so the predicate is a plain integer compare with
    /// no rounding ambiguity. The keeper derives `value` from the anchored TxLINE datapoint by
    /// outcome label (see resolveOutcomeValue / pctToValue in keeper/src/txline.ts).
    ///
    /// HOLD/BREAK ASYMMETRY — the two sides settle by opposite rules:
    ///   • BREAK wins the instant ANY update proves `value >= L` (the line "broke through"
    ///     resistance). The FIRST valid crossing proof settles it YES; one proof suffices.
    ///   • HOLD is the optimistic mirror: presumed to win, and only DISPROVEN early — a proof that
    ///     `value < L` at some point in the window means the line was defeated → NO.
    ///   • window_end is the challenge close: if it passes with BREAK unproven / HOLD undefeated,
    ///     the timeout branch below settles the DEFAULT outright (BREAK → NO, HOLD → YES), no proof.
    ///
    /// FAIL-SAFE: the keeper NEVER calls this on a guess — if an odds record has no PriceNames
    /// entry matching this market's outcome, it refuses to settle (returns null; see
    /// parseOddsValidation / resolveOutcomeValue), so a bad/missing mapping can't misresolve a
    /// market onto the wrong outcome.
    ///
    /// `value`/`proof` are validated by CPI into the TxLINE validator (mock_validator on devnet;
    /// the real txoracle `validate_odds` is implemented behind a flag — see TXLINE_VALIDATOR_ID).
    pub fn resolve_market<'info>(
        ctx: Context<'_, '_, '_, 'info, ResolveMarket<'info>>,
        value: i64,
        proof: Vec<u8>,
    ) -> Result<()> {
        require!(
            ctx.accounts.market.status == STATUS_OPEN,
            MarketError::AlreadyResolved
        );

        let side = ctx.accounts.market.side;
        let level = ctx.accounts.market.level;
        let window_start = ctx.accounts.market.window_start;
        let window_end = ctx.accounts.market.window_end;
        let fixture_id = ctx.accounts.market.fixture_id;
        let odd_key = ctx.accounts.market.odd_key;

        let now = Clock::get()?.unix_timestamp;

        // Challenge close: window is over with no resolving proof submitted.
        // BREAK never crossed L -> loses. HOLD never got defeated -> wins.
        if now >= window_end {
            let outcome = if side == MARKET_SIDE_BREAK {
                OUTCOME_NO
            } else {
                OUTCOME_YES
            };
            let m = &mut ctx.accounts.market;
            m.outcome = outcome;
            m.status = STATUS_RESOLVED;
            return Ok(());
        }

        require!(now >= window_start, MarketError::WindowNotStarted);

        // ---- TxLINE validation seam ----
        // ACTIVE demo path = mock_validator (TXLINE_PROGRAM_ID): approves any proof, so the
        // predicate below rides the keeper-supplied `value`. The REAL txoracle `validate_odds` CPI
        // (TXLINE_VALIDATOR_ID) is implemented in cpi_validate_odds but UNVERIFIED and dormant —
        // reached only if the keeper passes the real validator program. See TXLINE_VALIDATOR_ID.
        if ctx.accounts.txline_program.key() == TXLINE_VALIDATOR_ID {
            // REAL PATH (implemented-but-unverified): `proof` carries the borsh-encoded
            // OddsProofPayload; verify the Odds snapshot against the committed Merkle roots. A
            // production build would then derive `value` FROM the verified snapshot rather than
            // trusting the arg (the keeper's demargined Pct vs the snapshot's raw `prices`).
            let payload = OddsProofPayload::try_from_slice(&proof)
                .map_err(|_| error!(MarketError::ValidationFailed))?;
            let mut cpi_accounts: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            cpi_accounts.push(ctx.accounts.txline_program.to_account_info());
            cpi_validate_odds(
                ctx.accounts.txline_program.key(),
                ctx.remaining_accounts,
                &cpi_accounts,
                &payload,
            )?;
        } else {
            // MOCK PATH (active): forward the opaque proof to the mock validator.
            let mut cpi_accounts: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            cpi_accounts.push(ctx.accounts.txline_program.to_account_info());
            validate_with_txline(
                ctx.accounts.txline_program.key(),
                ctx.remaining_accounts,
                &cpi_accounts,
                fixture_id,
                odd_key,
                value,
                &proof,
            )?;
        }

        // ---- deterministic predicate over the verified value ----
        let outcome = match side {
            MARKET_SIDE_BREAK if value >= level => OUTCOME_YES,
            MARKET_SIDE_HOLD if value < level => OUTCOME_NO,
            MARKET_SIDE_BREAK | MARKET_SIDE_HOLD => {
                return err!(MarketError::ProofDoesNotResolve)
            }
            _ => return err!(MarketError::InvalidMarketSide),
        };

        let m = &mut ctx.accounts.market;
        m.outcome = outcome;
        m.status = STATUS_RESOLVED;
        Ok(())
    }

    /// Pays a winner their pro-rata payout from the vault. Deterministic and non-custodial.
    ///
    /// ELIGIBILITY: only the winning side may claim — `position.side == market.outcome` (YES backs
    /// the market's predicate coming true, NO backs it not); a losing position is rejected.
    ///
    /// PAYOUT (integer math, never rounds in the house's favour):
    ///   winnings = stake × lose_total / win_total   — pro-rata share of the LOSING pool
    ///   fee      = winnings × fee_bps / 10_000       — the "cut", taken on WINNINGS only
    ///   payout   = stake + winnings − fee            — your stake back + your share of the other side
    /// The fee routes to the market authority; the rest to the position `owner`. With an empty losing
    /// pool winnings = 0, so the winner simply gets their stake back (no counterparty, no profit).
    ///
    /// Permissionless: any signer may `payer` the transaction — funds always route to the position
    /// `owner`'s token account, so the keeper (or anyone) can push a winner's payout without the
    /// winner needing to sign. The winner can still self-claim as a fallback.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        // capture scalars before taking the mutable market/position borrows
        let outcome = ctx.accounts.market.outcome;
        let total_yes = ctx.accounts.market.total_yes;
        let total_no = ctx.accounts.market.total_no;
        let fee_bps = ctx.accounts.market.fee_bps as u128;
        let bump = ctx.accounts.market.bump;
        let fixture_id = ctx.accounts.market.fixture_id;
        let odd_key = ctx.accounts.market.odd_key;
        let market_params = ctx.accounts.market.market_params;
        let market_side = ctx.accounts.market.side;
        let level = ctx.accounts.market.level;
        let window_start = ctx.accounts.market.window_start;
        let side = ctx.accounts.position.side;
        let stake = ctx.accounts.position.amount as u128;

        require!(side == outcome, MarketError::LosingPosition);

        let (win_total, lose_total) = if outcome == OUTCOME_YES {
            (total_yes as u128, total_no as u128)
        } else {
            (total_no as u128, total_yes as u128)
        };
        require!(win_total > 0, MarketError::NoWinningStake);

        // pro-rata share of the losing pool, fee taken only on winnings
        let winnings = stake
            .checked_mul(lose_total)
            .ok_or(MarketError::Overflow)?
            / win_total;
        let fee = winnings
            .checked_mul(fee_bps)
            .ok_or(MarketError::Overflow)?
            / BPS_DENOMINATOR as u128;
        let payout = stake
            .checked_add(winnings.checked_sub(fee).ok_or(MarketError::Overflow)?)
            .ok_or(MarketError::Overflow)?;

        let payout_u64 = u64::try_from(payout).map_err(|_| error!(MarketError::Overflow))?;
        let fee_u64 = u64::try_from(fee).map_err(|_| error!(MarketError::Overflow))?;

        // market PDA signs vault transfers
        let fid = fixture_id.to_le_bytes();
        let oid = odd_key.to_le_bytes();
        let mp_b = market_params.to_le_bytes();
        let side_arr = [market_side];
        let level_b = level.to_le_bytes();
        let ws_b = window_start.to_le_bytes();
        let bump_arr = [bump];
        let seeds: &[&[u8]] = &[
            b"market".as_ref(),
            fid.as_ref(),
            oid.as_ref(),
            mp_b.as_ref(),
            side_arr.as_ref(),
            level_b.as_ref(),
            ws_b.as_ref(),
            bump_arr.as_ref(),
        ];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            payout_u64,
        )?;

        if fee_u64 > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.fee_token.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer,
                ),
                fee_u64,
            )?;
        }

        ctx.accounts.position.claimed = true;
        Ok(())
    }

    // =========================== Groups ===========================

    /// Opens a prediction group. A group is a named roster with its own fee: `fee_bps` is the
    /// group's cut on winnings at `claim_group` (Slice 4), surfaced in the UI as "Group fee: X%"
    /// / "Free" (0). Identity is (owner, group_id) so one owner can run several groups. The owner
    /// is implicitly the first member — `member_count` starts at 1 and no `GroupMember` account is
    /// minted for them (they're tracked by the `owner` field); `approve_member` mints/approves the
    /// rest. `visibility` (0 public / 1 private) and `roster` (whether members are shown to
    /// approved joiners) back the existing group UI.
    pub fn create_group(
        ctx: Context<CreateGroup>,
        group_id: u64,
        name: String,
        fee_bps: u16,
        visibility: u8,
        roster: bool,
    ) -> Result<()> {
        require!(name.len() <= Group::NAME_MAX_LEN, MarketError::NameTooLong);
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);
        require!(visibility <= GROUP_PRIVATE, MarketError::InvalidVisibility);

        let g = &mut ctx.accounts.group;
        g.owner = ctx.accounts.owner.key();
        g.group_id = group_id;
        g.name = name;
        g.fee_bps = fee_bps;
        g.visibility = visibility;
        g.roster = roster;
        g.member_count = 1; // the owner
        g.bump = ctx.bumps.group;
        Ok(())
    }

    /// A wallet asks to join a group: mints its `GroupMember` in the pending (`approved = false`)
    /// state. Permissionless to request — the owner gates entry via `approve_member`. Re-requesting
    /// fails at `init` (the PDA already exists), which is exactly the UI's "Requested" latch.
    pub fn request_join(ctx: Context<RequestJoin>) -> Result<()> {
        let m = &mut ctx.accounts.group_member;
        m.group = ctx.accounts.group.key();
        m.member = ctx.accounts.member.key();
        m.approved = false;
        m.bump = ctx.bumps.group_member;
        Ok(())
    }

    /// The group owner approves a pending member: flips `approved` false -> true and bumps the
    /// group's `member_count`. Only the `group.owner` may call it; approving an already-approved
    /// member is rejected so `member_count` can't be double-counted.
    pub fn approve_member(ctx: Context<ApproveMember>) -> Result<()> {
        require!(
            !ctx.accounts.group_member.approved,
            MarketError::AlreadyApproved
        );
        ctx.accounts.group_member.approved = true;
        let g = &mut ctx.accounts.group;
        g.member_count = g.member_count.checked_add(1).ok_or(MarketError::Overflow)?;
        Ok(())
    }

    /// The owner edits their group's settings — name, fee, visibility, roster. Identity
    /// (owner, group_id) is fixed, so a rename doesn't move the PDA. Owner-only.
    pub fn update_group(
        ctx: Context<UpdateGroup>,
        name: String,
        fee_bps: u16,
        visibility: u8,
        roster: bool,
    ) -> Result<()> {
        require!(name.len() <= Group::NAME_MAX_LEN, MarketError::NameTooLong);
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);
        require!(visibility <= GROUP_PRIVATE, MarketError::InvalidVisibility);
        let g = &mut ctx.accounts.group;
        g.name = name;
        g.fee_bps = fee_bps;
        g.visibility = visibility;
        g.roster = roster;
        Ok(())
    }

    /// A member leaves a group: closes their `GroupMember` (rent refunded to them) and, if they
    /// were approved, decrements `member_count`. The owner can't leave (they're the group's
    /// identity) — they'd have to abandon it. Pending requesters may also call this to cancel.
    pub fn leave_group(ctx: Context<LeaveGroup>) -> Result<()> {
        require_keys_neq!(
            ctx.accounts.member.key(),
            ctx.accounts.group.owner,
            MarketError::OwnerCannotLeave
        );
        if ctx.accounts.group_member.approved {
            let g = &mut ctx.accounts.group;
            g.member_count = g.member_count.saturating_sub(1);
        }
        Ok(()) // group_member account is closed by the `close = member` attribute
    }

    /// An approved group member stakes into a market *as part of the group*. Mechanically this is
    /// the individual `deposit` — funds go into the same market vault and bump `market.total_*`, so
    /// group money competes in the market's pool like everyone else's — but the per-member
    /// accounting lives in group-scoped PDAs instead of a `Position`: a shared `GroupPool`
    /// (group+market) aggregate and a per-member `GroupPosition`. `claim_group` (Slice 4) pays each
    /// member out of the market pro-rata from their `GroupPosition`, applying the *group's* fee.
    pub fn group_deposit(ctx: Context<GroupDeposit>, side: u8, amount: u64) -> Result<()> {
        require!(side == SIDE_YES || side == SIDE_NO, MarketError::InvalidSide);
        require!(amount > 0, MarketError::ZeroAmount);

        // Authorization: the group owner is the implicit first member and has NO GroupMember
        // account (see create_group), so they deposit without one. Everyone else must present
        // their own approved GroupMember for this group. `group_member` is optional precisely so
        // the owner can pass None.
        let signer = ctx.accounts.member.key();
        if signer != ctx.accounts.group.owner {
            let gm = ctx
                .accounts
                .group_member
                .as_ref()
                .ok_or(error!(MarketError::MemberNotApproved))?;
            require_keys_eq!(gm.group, ctx.accounts.group.key(), MarketError::Unauthorized);
            require_keys_eq!(gm.member, signer, MarketError::Unauthorized);
            require!(gm.approved, MarketError::MemberNotApproved);
        }

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.member_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.member.to_account_info(),
                },
            ),
            amount,
        )?;

        let gp = &mut ctx.accounts.group_position;
        gp.group = ctx.accounts.group.key();
        gp.market = ctx.accounts.market.key();
        gp.member = ctx.accounts.member.key();
        gp.side = side;
        gp.amount = gp.amount.checked_add(amount).ok_or(MarketError::Overflow)?;
        gp.claimed = false;
        gp.bump = ctx.bumps.group_position;

        let pool = &mut ctx.accounts.group_pool;
        pool.group = ctx.accounts.group.key();
        pool.market = ctx.accounts.market.key();
        pool.bump = ctx.bumps.group_pool;

        let m = &mut ctx.accounts.market;
        if side == SIDE_YES {
            pool.total_yes = pool.total_yes.checked_add(amount).ok_or(MarketError::Overflow)?;
            m.total_yes = m.total_yes.checked_add(amount).ok_or(MarketError::Overflow)?;
        } else {
            pool.total_no = pool.total_no.checked_add(amount).ok_or(MarketError::Overflow)?;
            m.total_no = m.total_no.checked_add(amount).ok_or(MarketError::Overflow)?;
        }
        Ok(())
    }

    /// Pays a group member their pro-rata payout on a resolved market. Identical winnings math to
    /// the individual `claim` — the member's `GroupPosition.amount` is the stake, and the market's
    /// `total_yes/total_no` (which already include this group's money, see `group_deposit`) are the
    /// win/lose pools — so payouts are automatically proportional to each member's contribution.
    /// The only differences from `claim`: settlement is keyed off the `GroupPosition`, and the fee
    /// is the *group's* `fee_bps` routed to the *group owner* (the group's house) rather than the
    /// market fee/authority. Permissionless: anyone may `payer`; funds route to the member.
    pub fn claim_group(ctx: Context<ClaimGroup>) -> Result<()> {
        let outcome = ctx.accounts.market.outcome;
        let total_yes = ctx.accounts.market.total_yes;
        let total_no = ctx.accounts.market.total_no;
        let fee_bps = ctx.accounts.group.fee_bps as u128; // the GROUP's fee, not the market's
        let bump = ctx.accounts.market.bump;
        let fixture_id = ctx.accounts.market.fixture_id;
        let odd_key = ctx.accounts.market.odd_key;
        let market_params = ctx.accounts.market.market_params;
        let market_side = ctx.accounts.market.side;
        let level = ctx.accounts.market.level;
        let window_start = ctx.accounts.market.window_start;
        let side = ctx.accounts.group_position.side;
        let stake = ctx.accounts.group_position.amount as u128;

        require!(side == outcome, MarketError::LosingPosition);

        let (win_total, lose_total) = if outcome == OUTCOME_YES {
            (total_yes as u128, total_no as u128)
        } else {
            (total_no as u128, total_yes as u128)
        };
        require!(win_total > 0, MarketError::NoWinningStake);

        // pro-rata share of the losing pool, group fee taken only on winnings
        let winnings = stake
            .checked_mul(lose_total)
            .ok_or(MarketError::Overflow)?
            / win_total;
        let fee = winnings
            .checked_mul(fee_bps)
            .ok_or(MarketError::Overflow)?
            / BPS_DENOMINATOR as u128;
        let payout = stake
            .checked_add(winnings.checked_sub(fee).ok_or(MarketError::Overflow)?)
            .ok_or(MarketError::Overflow)?;

        let payout_u64 = u64::try_from(payout).map_err(|_| error!(MarketError::Overflow))?;
        let fee_u64 = u64::try_from(fee).map_err(|_| error!(MarketError::Overflow))?;

        // market PDA signs vault transfers (same seeds as `claim`)
        let fid = fixture_id.to_le_bytes();
        let oid = odd_key.to_le_bytes();
        let mp_b = market_params.to_le_bytes();
        let side_arr = [market_side];
        let level_b = level.to_le_bytes();
        let ws_b = window_start.to_le_bytes();
        let bump_arr = [bump];
        let seeds: &[&[u8]] = &[
            b"market".as_ref(),
            fid.as_ref(),
            oid.as_ref(),
            mp_b.as_ref(),
            side_arr.as_ref(),
            level_b.as_ref(),
            ws_b.as_ref(),
            bump_arr.as_ref(),
        ];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.member_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            payout_u64,
        )?;

        if fee_u64 > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.fee_token.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer,
                ),
                fee_u64,
            )?;
        }

        ctx.accounts.group_position.claimed = true;
        Ok(())
    }
}

// ---- TxLINE CPI helper (the single swappable integration seam) ----
//
// Takes the proof-only accounts (for building the instruction's AccountMetas) and the
// full CPI account list (proof accounts + the validator program itself, for `invoke`)
// as two independent slices rather than combining them here — combining accounts
// sourced from different parts of `Context` (an `UncheckedAccount` field vs.
// `remaining_accounts`) inside one function trips Anchor's invariant account-info
// lifetimes; the caller already holds both in the same scope, so it combines them
// before calling in.
fn validate_with_txline(
    program_id: Pubkey,
    proof_accounts: &[AccountInfo],
    cpi_accounts: &[AccountInfo],
    fixture_id: u64,
    odd_key: u64,
    value: i64,
    proof: &[u8],
) -> Result<()> {
    use anchor_lang::solana_program::instruction::Instruction; // AccountMeta comes from prelude::*
    use anchor_lang::solana_program::program::invoke;

    let metas: Vec<AccountMeta> = proof_accounts
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();

    // ---- SWAP HERE for the real TxLINE IDL-encoded call ----
    // This layout is a placeholder: it binds `value` into the bytes sent for
    // verification (so it travels alongside `proof` instead of being a bare,
    // unrelated argument), but it is NOT the real TxLINE wire format. Once the
    // tx-on-chain repo's IDL is in hand, replace this with the anchor-encoded
    // `validate` instruction (8-byte discriminator + messageId/ts/proof args)
    // and swap `proof_accounts` for the real validator's expected account list
    // (batch-commitment PDA, etc.) instead of a raw remaining_accounts passthrough.
    // `mock_validator` ignores all of this and returns Ok, so this seam is safe
    // to point at it for a devnet demo in the meantime.
    let mut data = Vec::with_capacity(24 + proof.len());
    data.extend_from_slice(&fixture_id.to_le_bytes());
    data.extend_from_slice(&odd_key.to_le_bytes());
    data.extend_from_slice(&value.to_le_bytes());
    data.extend_from_slice(proof);

    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };

    invoke(&ix, cpi_accounts).map_err(|_| error!(MarketError::ValidationFailed))?;
    Ok(())
}

// ===================== Real txoracle `validate_odds` CPI =====================
//
// IMPLEMENTED-BUT-UNVERIFIED (see TXLINE_VALIDATOR_ID). This is the genuine on-chain validation
// using TxLINE's Merkle-proof primitives: an `Odds` snapshot is proven to belong to the committed
// `daily_odds_merkle_roots` via a sub-tree proof (odds within a fixture's batch) and a main-tree
// proof (that batch within the day's root). It is dormant — reached only when the keeper passes
// TXLINE_VALIDATOR_ID as `txline_program` — because no retrievable proof exists to run it yet.
//
// The argument structs below are mirrored field-for-field and IN ORDER from the txoracle IDL
// (keeper/txoracle.idl.json), so Borsh encodes byte-identically to what the validator deserializes.

/// txoracle `Odds` — one bookmaker's odds snapshot for a fixture. `prices` are decimal odds ×1000
/// (NOT the demargined Pct the keeper settles on — reconciling that gap is part of activation).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Odds {
    pub fixture_id: i64,
    pub message_id: String,
    pub ts: i64,
    pub bookmaker: String,
    pub bookmaker_id: i32,
    pub super_odds_type: String,
    pub game_state: Option<String>,
    pub in_running: bool,
    pub market_parameters: Option<String>,
    pub market_period: Option<String>,
    pub price_names: Vec<String>,
    pub prices: Vec<i32>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OddsUpdateStats {
    pub update_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

/// txoracle `OddsBatchSummary` — the fixture's odds sub-tree root + batch stats, hashed into the
/// main tree. Proving `odds_sub_tree_root` under the main tree is the second stage of validation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OddsBatchSummary {
    pub fixture_id: i64,
    pub update_stats: OddsUpdateStats,
    pub odds_sub_tree_root: [u8; 32],
}

/// One Merkle sibling: its hash and whether it sits to the right of the running hash.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

/// The full `validate_odds` argument set the keeper packs into resolve_market's `proof` bytes when
/// settling via the REAL validator. (The mock path ignores `proof` / passes it empty.)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OddsProofPayload {
    pub ts: i64,
    pub odds_snapshot: Odds,
    pub summary: OddsBatchSummary,
    pub sub_tree_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
}

/// Build and invoke the real txoracle `validate_odds` CPI from an encoded payload. Anchor wire
/// format = 8-byte discriminator ++ borsh(args in IDL order). The single account is the txoracle's
/// `daily_odds_merkle_roots` PDA, passed by the keeper as the first remaining_account.
///
/// VERIFIED — see TXLINE_VALIDATOR_ID for the proving transaction. To ACTIVATE for live settlement:
/// (1) fetch the proof AFTER its 5-min batch publishes (keeper `fetchPublishedOddsProof`);
/// (2) the keeper packs `OddsProofPayload` into `proof` and passes the txoracle roots account
///     (`HFYD3hVqavHeRUkBdo7vDHA8HTGhMLY2TsXvL536kGoV` on devnet) as the first remaining_account;
/// (3) point the keeper's TXLINE_PROGRAM_ID env at TXLINE_VALIDATOR_ID; and
/// (4) RAISE THE COMPUTE BUDGET — two-stage Merkle verification costs ~234k CU (the whole tx ~252k),
///     far over the 200k default, so the resolve tx needs a ComputeBudget setComputeUnitLimit ix.
// `proof_accounts` = validate_odds's own accounts (daily_odds_merkle_roots), used to build the
// instruction metas. `cpi_accounts` = those PLUS the validator program itself, for `invoke`. Kept as
// two slices (rather than combining here) to avoid mixing account-info lifetimes — same shape as
// validate_with_txline; the caller, holding both in one scope with a shared 'info, combines them.
fn cpi_validate_odds(
    program_id: Pubkey,
    proof_accounts: &[AccountInfo],
    cpi_accounts: &[AccountInfo],
    payload: &OddsProofPayload,
) -> Result<()> {
    use anchor_lang::solana_program::instruction::Instruction;
    use anchor_lang::solana_program::program::invoke;

    let mut data = Vec::with_capacity(256);
    data.extend_from_slice(&VALIDATE_ODDS_DISCRIMINATOR);
    payload.ts.serialize(&mut data)?;
    payload.odds_snapshot.serialize(&mut data)?;
    payload.summary.serialize(&mut data)?;
    payload.sub_tree_proof.serialize(&mut data)?;
    payload.main_tree_proof.serialize(&mut data)?;

    let metas: Vec<AccountMeta> = proof_accounts
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };
    invoke(&ix, cpi_accounts).map_err(|_| error!(MarketError::ValidationFailed))?;
    Ok(())
}

// =========================== Accounts ===========================

#[derive(Accounts)]
#[instruction(fixture_id: u64, odd_key: u64, market_params: u64, side: u8, level: i64, window_start: i64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [
            b"market",
            fixture_id.to_le_bytes().as_ref(),
            odd_key.to_le_bytes().as_ref(),
            market_params.to_le_bytes().as_ref(),
            side.to_le_bytes().as_ref(),
            level.to_le_bytes().as_ref(),
            window_start.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
            market.market_params.to_le_bytes().as_ref(),
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
        constraint = market.status == STATUS_OPEN @ MarketError::MarketNotOpen,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref(), &[side]],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token.mint == market.usdc_mint @ MarketError::WrongMint,
        constraint = user_token.owner == user.key() @ MarketError::Unauthorized,
    )]
    pub user_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Permissionless: anyone may submit a resolving proof. Only pays the tx fee.
    pub resolver: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
            market.market_params.to_le_bytes().as_ref(),
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: the validator program to CPI into, pinned to one of two known addresses: the
    /// mock_validator (TXLINE_PROGRAM_ID, active demo path) or the real txoracle validator
    /// (TXLINE_VALIDATOR_ID, implemented-but-unverified). resolve_market branches on which one.
    #[account(
        constraint = txline_program.key() == TXLINE_PROGRAM_ID
            || txline_program.key() == TXLINE_VALIDATOR_ID
            @ MarketError::UnknownValidator
    )]
    pub txline_program: UncheckedAccount<'info>,
    // proof-specific accounts (e.g. daily_odds_merkle_roots) are passed as remaining_accounts
}

#[derive(Accounts)]
pub struct Claim<'info> {
    /// Pays the transaction fee. Permissionless — not coupled to the position, so the keeper
    /// (or anyone) can settle a winner's payout. Funds route to `owner`, never to `payer`.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the position owner. Not a signer — used only to derive the position PDA and as
    /// the required owner of `user_token`, so a claim can only ever pay the legitimate winner.
    pub owner: UncheckedAccount<'info>,

    #[account(
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
            market.market_params.to_le_bytes().as_ref(),
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
        constraint = market.status == STATUS_RESOLVED @ MarketError::NotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &[position.side]],
        bump = position.bump,
        constraint = position.owner == owner.key() @ MarketError::Unauthorized,
        constraint = !position.claimed @ MarketError::AlreadyClaimed,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token.owner == owner.key() @ MarketError::Unauthorized,
        constraint = user_token.mint == market.usdc_mint @ MarketError::WrongMint,
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token.owner == market.authority @ MarketError::Unauthorized,
        constraint = fee_token.mint == market.usdc_mint @ MarketError::WrongMint,
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct CreateGroup<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Group::INIT_SPACE,
        seeds = [b"group", owner.key().as_ref(), group_id.to_le_bytes().as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestJoin<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    pub group: Account<'info, Group>,

    #[account(
        init,
        payer = member,
        space = 8 + GroupMember::INIT_SPACE,
        seeds = [b"member", group.key().as_ref(), member.key().as_ref()],
        bump
    )]
    pub group_member: Account<'info, GroupMember>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveMember<'info> {
    /// Must be the group owner — enforced by the `group.owner == owner` constraint below.
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"group", group.owner.as_ref(), group.group_id.to_le_bytes().as_ref()],
        bump = group.bump,
        constraint = group.owner == owner.key() @ MarketError::NotGroupOwner,
    )]
    pub group: Account<'info, Group>,

    #[account(
        mut,
        seeds = [b"member", group.key().as_ref(), group_member.member.as_ref()],
        bump = group_member.bump,
        constraint = group_member.group == group.key() @ MarketError::Unauthorized,
    )]
    pub group_member: Account<'info, GroupMember>,
}

#[derive(Accounts)]
pub struct UpdateGroup<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"group", group.owner.as_ref(), group.group_id.to_le_bytes().as_ref()],
        bump = group.bump,
        constraint = group.owner == owner.key() @ MarketError::NotGroupOwner,
    )]
    pub group: Account<'info, Group>,
}

#[derive(Accounts)]
pub struct LeaveGroup<'info> {
    /// The leaving member — receives the closed GroupMember's rent.
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        mut,
        seeds = [b"group", group.owner.as_ref(), group.group_id.to_le_bytes().as_ref()],
        bump = group.bump,
    )]
    pub group: Account<'info, Group>,

    #[account(
        mut,
        close = member,
        seeds = [b"member", group.key().as_ref(), member.key().as_ref()],
        bump = group_member.bump,
        constraint = group_member.group == group.key() @ MarketError::Unauthorized,
        constraint = group_member.member == member.key() @ MarketError::Unauthorized,
    )]
    pub group_member: Account<'info, GroupMember>,
}

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct GroupDeposit<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    pub group: Account<'info, Group>,

    /// The caller's membership in `group`. OPTIONAL: the group owner is the implicit first member
    /// and has no GroupMember account, so they pass None; every other depositor passes their own
    /// approved membership. Ownership of the passed account (group + member match) and approval are
    /// validated in the handler.
    pub group_member: Option<Account<'info, GroupMember>>,

    #[account(
        mut,
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
            market.market_params.to_le_bytes().as_ref(),
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
        constraint = market.status == STATUS_OPEN @ MarketError::MarketNotOpen,
    )]
    pub market: Account<'info, Market>,

    /// Shared per-(group, market) aggregate — the "group pool" that fills as members deposit.
    #[account(
        init_if_needed,
        payer = member,
        space = 8 + GroupPool::INIT_SPACE,
        seeds = [b"grouppool", group.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub group_pool: Account<'info, GroupPool>,

    /// This member's contribution to (group, market) on `side`. Mirrors an individual Position.
    #[account(
        init_if_needed,
        payer = member,
        space = 8 + GroupPosition::INIT_SPACE,
        seeds = [b"grouppos", group.key().as_ref(), market.key().as_ref(), member.key().as_ref(), &[side]],
        bump
    )]
    pub group_position: Account<'info, GroupPosition>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token.mint == market.usdc_mint @ MarketError::WrongMint,
        constraint = member_token.owner == member.key() @ MarketError::Unauthorized,
    )]
    pub member_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimGroup<'info> {
    /// Pays the tx fee. Permissionless — not coupled to the member, so the keeper (or anyone) can
    /// settle a group winner's payout. Funds route to `member`, never to `payer`.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the group member being paid. Not a signer — used to derive the GroupPosition PDA and
    /// as the required owner of `member_token`, so a claim can only ever pay the legitimate member.
    pub member: UncheckedAccount<'info>,

    /// Supplies the group fee (`fee_bps`) and the fee recipient (`owner`). Tied to the position by
    /// the `group_position.group == group` constraint below.
    pub group: Account<'info, Group>,

    #[account(
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
            market.market_params.to_le_bytes().as_ref(),
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
        constraint = market.status == STATUS_RESOLVED @ MarketError::NotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"grouppos", group.key().as_ref(), market.key().as_ref(), member.key().as_ref(), &[group_position.side]],
        bump = group_position.bump,
        constraint = group_position.group == group.key() @ MarketError::Unauthorized,
        constraint = group_position.market == market.key() @ MarketError::Unauthorized,
        constraint = group_position.member == member.key() @ MarketError::Unauthorized,
        constraint = !group_position.claimed @ MarketError::AlreadyClaimed,
    )]
    pub group_position: Account<'info, GroupPosition>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token.owner == member.key() @ MarketError::Unauthorized,
        constraint = member_token.mint == market.usdc_mint @ MarketError::WrongMint,
    )]
    pub member_token: Account<'info, TokenAccount>,

    /// The group's fee sink — must be owned by the group owner (the group's house).
    #[account(
        mut,
        constraint = fee_token.owner == group.owner @ MarketError::Unauthorized,
        constraint = fee_token.mint == market.usdc_mint @ MarketError::WrongMint,
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// =========================== State ===========================

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub fixture_id: u64,
    pub odd_key: u64,
    pub market_params: u64, // SuperOddsType params (Over/Under goal line × 100; 0 if none, e.g. 1X2)
    pub side: u8, // MARKET_SIDE_HOLD | MARKET_SIDE_BREAK
    pub level: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub status: u8,
    pub outcome: u8,
    pub total_yes: u64,
    pub total_no: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: u8, // SIDE_YES | SIDE_NO
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

// Group.visibility
pub const GROUP_PUBLIC: u8 = 0;
pub const GROUP_PRIVATE: u8 = 1;

/// A named prediction group with its own fee. See `create_group`.
#[account]
#[derive(InitSpace)]
pub struct Group {
    pub owner: Pubkey,
    pub group_id: u64,
    #[max_len(48)]
    pub name: String,
    pub fee_bps: u16,     // group's cut on winnings at claim_group; 0 = "Free"
    pub visibility: u8,   // GROUP_PUBLIC | GROUP_PRIVATE
    pub roster: bool,     // whether members are shown to approved joiners
    pub member_count: u32,
    pub bump: u8,
}

impl Group {
    pub const NAME_MAX_LEN: usize = 48;
}

/// One member's standing in a group. Minted on `request_join`, flipped to `approved` by the
/// owner via `approve_member` (Slice 2). The owner isn't given a GroupMember (see `create_group`).
#[account]
#[derive(InitSpace)]
pub struct GroupMember {
    pub group: Pubkey,
    pub member: Pubkey,
    pub approved: bool,
    pub bump: u8,
}

/// Shared aggregate of a group's stake in one market — the "group pool". Sum of all members'
/// group_deposits on each side. Display + a cross-check on the per-member GroupPositions.
#[account]
#[derive(InitSpace)]
pub struct GroupPool {
    pub group: Pubkey,
    pub market: Pubkey,
    pub total_yes: u64,
    pub total_no: u64,
    pub bump: u8,
}

/// One member's contribution to a (group, market) on a given side. The unit `claim_group` pays
/// out pro-rata (mirrors an individual Position, but settled through the group with the group fee).
#[account]
#[derive(InitSpace)]
pub struct GroupPosition {
    pub group: Pubkey,
    pub market: Pubkey,
    pub member: Pubkey,
    pub side: u8, // SIDE_YES | SIDE_NO
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

// =========================== Errors ===========================

#[error_code]
pub enum MarketError {
    #[msg("fee_bps exceeds 10000")]
    InvalidFee,
    #[msg("side must be YES (1) or NO (2)")]
    InvalidSide,
    #[msg("market side must be HOLD (0) or BREAK (1)")]
    InvalidMarketSide,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("market is not open for deposits")]
    MarketNotOpen,
    #[msg("window_end must be after window_start")]
    InvalidWindow,
    #[msg("token account mint does not match the market USDC mint")]
    WrongMint,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("market already resolved")]
    AlreadyResolved,
    #[msg("window has not started yet")]
    WindowNotStarted,
    #[msg("proof does not resolve this market yet (no crossing / no defeat)")]
    ProofDoesNotResolve,
    #[msg("TxLINE proof validation failed")]
    ValidationFailed,
    #[msg("market is not resolved yet")]
    NotResolved,
    #[msg("signer not authorized for this account")]
    Unauthorized,
    #[msg("position already claimed")]
    AlreadyClaimed,
    #[msg("position is on the losing side")]
    LosingPosition,
    #[msg("no stake on the winning side")]
    NoWinningStake,
    #[msg("group name exceeds max length")]
    NameTooLong,
    #[msg("visibility must be public (0) or private (1)")]
    InvalidVisibility,
    #[msg("signer is not the group owner")]
    NotGroupOwner,
    #[msg("member is already approved")]
    AlreadyApproved,
    #[msg("group member is not approved")]
    MemberNotApproved,
    #[msg("the group owner cannot leave their own group")]
    OwnerCannotLeave,
    #[msg("txline_program is neither the mock nor the real TxLINE validator")]
    UnknownValidator,
}
