use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

// Mock stand-in for TxLINE's validator. It accepts ANY instruction data (including the
// empty bytes the keeper sends in mock mode) and ANY accounts, and returns Ok(()) so the
// `resolve_market` CPI in signal_markets succeeds end-to-end on devnet.
//
// This is ONLY for demos/tests. The real TxLINE validator verifies the Merkle proof against
// the on-chain batch commitment; this one verifies nothing. Never deploy to mainnet.
entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    msg!("mock_validator: proof approved (demo only)");
    Ok(())
}
