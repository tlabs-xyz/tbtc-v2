use crate::state::Custodian;
use anchor_lang::prelude::*;
use anchor_spl::token;
use wormhole_anchor_sdk::token_bridge;

const TBTC_FOREIGN_TOKEN_CHAIN: u8 = 2;

#[cfg(feature = "mainnet")]
const TBTC_FOREIGN_TOKEN_ADDRESS: [u8; 32] = [
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x18, 0x08, 0x4f, 0xbA, 0x66, 0x6a,
    0x33, 0xd3, 0x75, 0x92, 0xfA, 0x26, 0x33, 0xfD, 0x49, 0xa7, 0x4D, 0xD9, 0x3a, 0x88,
];

/// TODO: Fix this to reflect testnet contract address.
#[cfg(feature = "solana-devnet")]
const TBTC_FOREIGN_TOKEN_ADDRESS: [u8; 32] = [
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x18, 0x08, 0x4f, 0xbA, 0x66, 0x6a,
    0x33, 0xd3, 0x75, 0x92, 0xfA, 0x26, 0x33, 0xfD, 0x49, 0xa7, 0x4D, 0xD9, 0x3a, 0x88,
];

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Custodian::INIT_SPACE,
        seeds = [Custodian::SEED_PREFIX],
        bump,
    )]
    custodian: Account<'info, Custodian>,

    /// TBTC Program's mint PDA address bump is saved in this program's config. Ordinarily, we would
    /// not have to deserialize this account. But we do in this case to make sure the TBTC program
    /// has been initialized before this program.
    #[account(
        seeds = [tbtc::SEED_PREFIX_TBTC_MINT],
        bump,
        seeds::program = tbtc::ID
    )]
    tbtc_mint: Account<'info, token::Mint>,

    #[account(
        seeds = [
            token_bridge::WrappedMint::SEED_PREFIX,
            &TBTC_FOREIGN_TOKEN_CHAIN.to_be_bytes(),
            TBTC_FOREIGN_TOKEN_ADDRESS.as_ref()
        ],
        bump
    )]
    wrapped_tbtc_mint: Account<'info, token::Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = wrapped_tbtc_mint,
        token::authority = authority,
        seeds = [b"wrapped-token"],
        bump
    )]
    wrapped_tbtc_token: Account<'info, token::TokenAccount>,

    /// CHECK: This account is needed for the Token Bridge program. This PDA is specifically used to
    /// sign for transferring via Token Bridge program with a message.
    #[account(
        seeds = [token_bridge::SEED_PREFIX_SENDER],
        bump,
    )]
    token_bridge_sender: AccountInfo<'info>,

    /// CHECK: This account is needed for the Token Bridge program. This PDA is specifically used to
    /// sign for transferring via Token Bridge program with a message.
    #[account(
        seeds = [token_bridge::SEED_PREFIX_REDEEMER],
        bump,
    )]
    token_bridge_redeemer: AccountInfo<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn initialize(ctx: Context<Initialize>, minting_limit: u64) -> Result<()> {
    ctx.accounts.custodian.set_inner(Custodian {
        bump: ctx.bumps["config"],
        authority: ctx.accounts.authority.key(),
        tbtc_mint: ctx.accounts.tbtc_mint.key(),
        wrapped_tbtc_mint: ctx.accounts.wrapped_tbtc_mint.key(),
        wrapped_tbtc_token: ctx.accounts.wrapped_tbtc_token.key(),
        token_bridge_sender: ctx.accounts.token_bridge_sender.key(),
        token_bridge_sender_bump: ctx.bumps["token_bridge_sender"],
        token_bridge_redeemer: ctx.accounts.token_bridge_sender.key(),
        token_bridge_redeemer_bump: ctx.bumps["token_bridge_redeemer"],
        minting_limit,
    });

    Ok(())
}
