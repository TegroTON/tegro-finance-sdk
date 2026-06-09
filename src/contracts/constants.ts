// On-chain constants for the Tegro Finance DEX router — a STON.fi V2.2-compatible
// fork. Ported verbatim from the production backend
// (src/ton_tools/constants.py · TonConstants) on 2026-06-09. These op-codes and
// gas amounts are what the live mainnet contracts expect; changing them produces
// transactions the router will refund or drop. Do not "tidy" the numbers.

/** Op-codes carried in message bodies (32-bit prefixes). */
export const OpCodes = {
  /** TEP-74 jetton transfer. */
  JETTON_TRANSFER: 0x0f8a7ea5,
  JETTON_TRANSFER_NOTIFICATION: 0x7362d09c,
  EXCESS: 0xd53276db,

  /** pTON/tgTON wrap — native TON tokenization (ton_transfer_tegro_v1). */
  PTON_TON_TRANSFER: 0x4425460e,

  // --- DEX router (STON.fi V2.2 fork) ---
  /** Internal router swap op. NOT used as a forward-payload op (see CROSS_SWAP). */
  SWAP: 0x2bc3153f,
  /** The op that goes in the swap forward payload to the router. */
  CROSS_SWAP: 0x4048a461,
  PROVIDE_LIQUIDITY: 0x54516d94,
  DIRECT_ADD_LIQUIDITY: 0x0ffe1306,
  REFUND_ME: 0x6213d9fd,
  RESET_GAS: 0x2f5f4058,
  COLLECT_FEES: 0x30873baf,
  WITHDRAW_FEE: 0x178d991f,
  BURN_LIQUIDITY: 0x595f07bc,
  /** protocol_admin → router: toggles a pool's is_locked. */
  UPDATE_POOL_STATUS: 0x2fd41e53,
  PAY_TO: 0x184390ca,
} as const;

/**
 * Gas / forward amounts in nanotons. `*_FORWARD` is the `forward_ton_amount`
 * carried inside the transfer; the plain key is the total TON attached to the
 * outgoing message. For TON-leg operations the attached amount is
 * `forward + offer`, computed by the Router.
 */
export const Gas = {
  TON_TRANSFER_FEE: 10_000_000n,
  JETTON_TRANSFER_FEE: 50_000_000n,
  JETTON_TRANSFER_FORWARD_TON_AMOUNT: 1_000_000n,

  // swap
  SWAP: 220_000_000n,
  SWAP_JETTON_TO_TON: 170_000_000n,
  SWAP_MIN: 65_000_000n,
  SWAP_FORWARD: 175_000_000n,
  /** TON→jetton leg must cover the full cross_swap chain (route→pool→pay_to→vault→wallet). */
  SWAP_TON_TO_JETTON_FORWARD: 300_000_000n,
  SWAP_JETTON_TO_TON_FORWARD: 125_000_000n,

  // liquidity
  PROVIDE_LP: 300_000_000n,
  PROVIDE_LP_TON_FORWARD: 265_000_000n,
  PROVIDE_LP_JETTON_FORWARD: 240_000_000n,
  BURN_LIQUIDITY: 500_000_000n,
  DIRECT_ADD_LP: 300_000_000n,
  REFUND: 300_000_000n,

  // admin
  UPDATE_POOL_STATUS: 200_000_000n,
} as const;

/** Default swap/provide deadline window baked into the body, in seconds. */
export const TX_DEADLINE_SECONDS = 15 * 60;

/** TON Connect `valid_until` window, in seconds. */
export const PREPARED_TRANSACTION_LIFETIME_SECONDS = 5 * 60;
