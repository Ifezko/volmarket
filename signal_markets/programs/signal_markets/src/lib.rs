use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Placeholder sentinel (Solana's System Program id) so an un-swapped build fails loudly
// instead of silently CPI-ing into something plausible-looking. Before deploying, point
// this at the real TxLINE validator (see
// https://txline-docs.txodds.com/documentation/programs/addresses) or, for a devnet demo,
// at `mock_validator`'s deployed program id.
pub const TXLINE_PROGRAM_ID: Pubkey = anchor_lang::solana_program::system_program::ID;

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
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: u64,
        odd_key: u64,
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
        m.side = side;
        m.level = level;
        m.window_start = window_start;
        m.window_end = window_end;
        m.usdc_mint = ctx.accounts.usdc_mint.key();
        m.vault = ctx.accounts.vault.key();
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

    /// Permissionless single-proof settlement.
    ///
    /// BREAK resolves the moment anyone submits the update where value >= L (one proof,
    /// CPI'd through TxLINE's validator). HOLD is the mirror, settled optimistically: it
    /// wins by default, and anyone may defeat it early by submitting the update where
    /// value dipped below L. If the window closes with BREAK unproven or HOLD undefeated,
    /// the default outcome wins outright — window_end doubles as HOLD's challenge close.
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
        // Verifies `value` is the genuine anchored StablePrice datapoint `proof` claims
        // it is. Swap the encoding inside `validate_with_txline` for the real IDL-encoded
        // call once available; until then point TXLINE_PROGRAM_ID at `mock_validator`.
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

    /// Winner claims pro-rata payout from the vault. The fee_bps "cut" is taken on
    /// winnings only and routes to the market authority. Non-custodial throughout.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        // capture scalars before taking the mutable market/position borrows
        let outcome = ctx.accounts.market.outcome;
        let total_yes = ctx.accounts.market.total_yes;
        let total_no = ctx.accounts.market.total_no;
        let fee_bps = ctx.accounts.market.fee_bps as u128;
        let bump = ctx.accounts.market.bump;
        let fixture_id = ctx.accounts.market.fixture_id;
        let odd_key = ctx.accounts.market.odd_key;
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
        let side_arr = [market_side];
        let level_b = level.to_le_bytes();
        let ws_b = window_start.to_le_bytes();
        let bump_arr = [bump];
        let seeds: &[&[u8]] = &[
            b"market".as_ref(),
            fid.as_ref(),
            oid.as_ref(),
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
    use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
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

// =========================== Accounts ===========================

#[derive(Accounts)]
#[instruction(fixture_id: u64, odd_key: u64, side: u8, level: i64, window_start: i64)]
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
            market.side.to_le_bytes().as_ref(),
            market.level.to_le_bytes().as_ref(),
            market.window_start.to_le_bytes().as_ref(),
        ],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: TxLINE validator program (or mock_validator on devnet), pinned by address.
    #[account(address = TXLINE_PROGRAM_ID)]
    pub txline_program: UncheckedAccount<'info>,
    // proof-specific accounts (e.g. the batch-commitment PDA) are passed as remaining_accounts
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [
            b"market",
            market.fixture_id.to_le_bytes().as_ref(),
            market.odd_key.to_le_bytes().as_ref(),
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
        seeds = [b"position", market.key().as_ref(), user.key().as_ref(), &[position.side]],
        bump = position.bump,
        constraint = position.owner == user.key() @ MarketError::Unauthorized,
        constraint = !position.claimed @ MarketError::AlreadyClaimed,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token.owner == user.key() @ MarketError::Unauthorized,
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

// =========================== State ===========================

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub fixture_id: u64,
    pub odd_key: u64,
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
}
