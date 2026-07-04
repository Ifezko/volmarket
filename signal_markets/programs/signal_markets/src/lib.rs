use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Placeholder. Replace with the real TxLINE validator program id from
// https://txline-docs.txodds.com/documentation/programs/addresses
pub const TXLINE_PROGRAM_ID: Pubkey = pubkey!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub const BPS_DENOMINATOR: u64 = 10_000;

// ----- enum-like u8 constants (kept as u8 for simple, robust serialization) -----
pub const CMP_LTE: u8 = 0;
pub const CMP_GTE: u8 = 1;
pub const CMP_EQ: u8 = 2;

pub const SIDE_YES: u8 = 1;
pub const SIDE_NO: u8 = 2;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_LOCKED: u8 = 1;
pub const STATUS_RESOLVED: u8 = 2;

pub const OUTCOME_UNSET: u8 = 0;
pub const OUTCOME_YES: u8 = 1;
pub const OUTCOME_NO: u8 = 2;

// market_type: 0 = score stat, 1 = odds threshold, 2 = odds movement
// resolution_mode: 0 = deterministic, 1 = optimistic

#[program]
pub mod signal_markets {
    use super::*;

    /// Host creates a market over a TxLINE-settleable predicate and inits the USDC vault PDA.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        fixture_id: u64,
        market_type: u8,
        resolution_mode: u8,
        predicate: Predicate,
        fee_bps: u16,
        deadline: i64,
        group: Pubkey,
    ) -> Result<()> {
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);
        require!(
            matches!(predicate.comparator, CMP_LTE | CMP_GTE | CMP_EQ),
            MarketError::InvalidComparator
        );

        let m = &mut ctx.accounts.market;
        m.market_id = market_id;
        m.fixture_id = fixture_id;
        m.authority = ctx.accounts.authority.key();
        m.usdc_mint = ctx.accounts.usdc_mint.key();
        m.vault = ctx.accounts.vault.key();
        m.fee_recipient = ctx.accounts.authority.key();
        m.group = group;
        m.predicate = predicate;
        m.fee_bps = fee_bps;
        m.deadline = deadline;
        m.market_type = market_type;
        m.resolution_mode = resolution_mode;
        m.status = STATUS_OPEN;
        m.outcome = OUTCOME_UNSET;
        m.total_yes = 0;
        m.total_no = 0;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Optional grouping layer: a shared label + fee config that members predict under.
    pub fn create_group(ctx: Context<CreateGroup>, group_id: u64, fee_bps: u16) -> Result<()> {
        require!(fee_bps as u64 <= BPS_DENOMINATOR, MarketError::InvalidFee);
        let g = &mut ctx.accounts.group;
        g.group_id = group_id;
        g.creator = ctx.accounts.creator.key();
        g.market = ctx.accounts.market.key();
        g.fee_bps = fee_bps;
        g.member_count = 0;
        g.bump = ctx.bumps.group;
        Ok(())
    }

    /// User stakes USDC on a side. Funds move into the market vault PDA.
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
        pos.amount = pos
            .amount
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
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

    /// Permissionless resolution. Verifies the datapoint against TxLINE on-chain,
    /// then evaluates the deterministic predicate to set the outcome.
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        datapoint_value: i64,
        proof: Vec<u8>,
    ) -> Result<()> {
        require!(
            ctx.accounts.market.status == STATUS_OPEN
                || ctx.accounts.market.status == STATUS_LOCKED,
            MarketError::AlreadyResolved
        );

        // ---- TxLINE validation seam ----
        // CPI into the TxLINE validate instruction. Replace `proof` bytes with the
        // anchor-encoded `validate_stat` call (discriminator + args) from the devnet IDL:
        // https://txline-docs.txodds.com/documentation/programs/devnet
        validate_with_txline(
            &ctx.accounts.txline_program,
            ctx.remaining_accounts,
            &proof,
        )?;

        // ---- deterministic predicate evaluation over the verified value ----
        let p = &ctx.accounts.market.predicate;
        let hit = match p.comparator {
            CMP_LTE => datapoint_value <= p.value,
            CMP_GTE => datapoint_value >= p.value,
            CMP_EQ => datapoint_value == p.value,
            _ => return err!(MarketError::InvalidComparator),
        };

        let m = &mut ctx.accounts.market;
        m.outcome = if hit { OUTCOME_YES } else { OUTCOME_NO };
        m.status = STATUS_RESOLVED;
        Ok(())
    }

    /// Winner claims pro-rata payout from the vault. The fee_bps "cut" routes to the fee recipient.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        // capture scalars before taking the mutable position borrow
        let outcome = ctx.accounts.market.outcome;
        let total_yes = ctx.accounts.market.total_yes;
        let total_no = ctx.accounts.market.total_no;
        let fee_bps = ctx.accounts.market.fee_bps as u128;
        let bump = ctx.accounts.market.bump;
        let market_id = ctx.accounts.market.market_id;
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
        let mid = market_id.to_le_bytes();
        let bump_arr = [bump];
        let seeds: &[&[u8]] = &[b"market".as_ref(), mid.as_ref(), bump_arr.as_ref()];
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

// ---- TxLINE CPI helper (integration seam) ----
fn validate_with_txline(
    txline_program: &UncheckedAccount,
    proof_accounts: &[AccountInfo],
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

    let ix = Instruction {
        program_id: txline_program.key(),
        accounts: metas,
        data: proof.to_vec(),
    };

    let mut infos = proof_accounts.to_vec();
    infos.push(txline_program.to_account_info());

    invoke(&ix, &infos).map_err(|_| error!(MarketError::ValidationFailed))?;
    Ok(())
}

// =========================== Accounts ===========================

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
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
#[instruction(group_id: u64)]
pub struct CreateGroup<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = creator,
        space = 8 + Group::INIT_SPACE,
        seeds = [b"group", group_id.to_le_bytes().as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.market_id.to_le_bytes().as_ref()],
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
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: TxLINE validator program, pinned by address.
    #[account(address = TXLINE_PROGRAM_ID)]
    pub txline_program: UncheckedAccount<'info>,
    // proof accounts are passed as remaining_accounts
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"market", market.market_id.to_le_bytes().as_ref()],
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
        constraint = fee_token.owner == market.fee_recipient @ MarketError::Unauthorized,
        constraint = fee_token.mint == market.usdc_mint @ MarketError::WrongMint,
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// =========================== State ===========================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Predicate {
    pub stat_key: u32,
    pub comparator: u8,
    pub value: i64,
    pub window_start: i64,
    pub window_end: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: u64,
    pub fixture_id: u64,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub fee_recipient: Pubkey,
    pub group: Pubkey,
    pub predicate: Predicate,
    pub fee_bps: u16,
    pub deadline: i64,
    pub market_type: u8,
    pub resolution_mode: u8,
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
    pub side: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Group {
    pub group_id: u64,
    pub creator: Pubkey,
    pub market: Pubkey,
    pub fee_bps: u16,
    pub member_count: u32,
    pub bump: u8,
}

// =========================== Errors ===========================

#[error_code]
pub enum MarketError {
    #[msg("fee_bps exceeds 10000")]
    InvalidFee,
    #[msg("side must be YES (1) or NO (2)")]
    InvalidSide,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("market is not open for deposits")]
    MarketNotOpen,
    #[msg("token account mint does not match the market USDC mint")]
    WrongMint,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("market already resolved")]
    AlreadyResolved,
    #[msg("invalid comparator")]
    InvalidComparator,
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
