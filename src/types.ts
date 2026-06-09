// Type definitions for the Tegro Finance DEX HTTP API.
//
// Sources verified 2026-06-09 against the live backend (FastAPI) that powers
// tegro.finance, mirroring its Pydantic response/request models exactly:
//   GET  /api/v1/pools
//   GET  /api/v1/pools/{token_address}
//   GET  /api/v1/wallet/{wallet_address}/get_pools
//   GET  /api/v1/pools-pairs , /api/v1/pools-pairs/for/{token_address}
//   GET  /api/v1/assets
//   GET  /api/v1/tokens/{address}/data
//   POST /api/v1/swap/simulate , /api/v1/reverse_swap/simulate
//   POST /api/v1/swap
//   POST /api/v1/dex/liquidity/provide/simulate
//   POST /api/v1/dex/liquidity/provide , .../provide_complete , .../provide_complete_activate
//   POST /api/v1/dex/liquidity/remove , /api/v1/dex/liquidity/create
//   POST /api/v1/dex/pool/unlock
//
// Conventions (read these once, they apply everywhere):
//   • Addresses are EQ.../UQ... bounceable strings.
//   • "units" = the token's smallest unit (an integer). Multiply a human
//     amount by 10**decimals to get units, or use `toUnits()` from this SDK.
//   • Fee values (lp_fee, protocol_fee, ref_fee) are in basis points of
//     hundredths — i.e. `20` means 0.20%. Divide by 100 for a percentage.
//   • The DEX is non-custodial: swap/liquidity "build" endpoints return a
//     ready TON Connect message list; the user's WALLET signs it. The SDK
//     and the backend never hold a private key.

/** TON native-coin sentinel address used by the API in place of a jetton master. */
export const TON_NATIVE_ADDRESS =
  "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

// ---- amounts ------------------------------------------------------------

/**
 * A token amount in the smallest unit.
 *
 * Accepted on the way IN as `bigint | number | string`; the client serializes
 * it as a real JSON integer (bigint-safe — values above 2**53 keep full
 * precision on the wire). Returned FROM the API as `number` (the upstream
 * encodes them as JSON numbers); for amounts above 2**53 read the matching
 * `*_raw` field where provided, or parse the raw response yourself.
 */
export type UnitsInput = bigint | number | string;

// ---- assets -------------------------------------------------------------

/** One entry of the `GET /api/v1/assets` map (keyed by contract address). */
export interface Asset {
  contract_address: string;
  symbol: string;
  decimals: number;
  display_name: string | null;
  image_url: string | null;
  is_community: boolean;
  is_deprecated: boolean;
}

/** `GET /api/v1/assets` → a map of `contract_address` → {@link Asset}. */
export type AssetMap = Record<string, Asset>;

/** `GET /api/v1/tokens/{address}/data` — market snapshot from our dyor mirror. */
export interface TokenData {
  contract_address: string;
  symbol: string;
  name: string | null;
  image_url: string | null;
  price_usd: number | null;
  holders_count: number | null;
  liquidity_usd: number | null;
  mcap: number | null;
  trust_score: number | null;
  verification: string | null;
  fetched_at: string | null;
  source: string | null;
  data: unknown;
}

// ---- pools --------------------------------------------------------------

/** A liquidity pool as returned by `GET /api/v1/pools`. */
export interface Pool {
  address: string;
  router_address: string;
  token0_address: string;
  token1_address: string;
  reserve0: number;
  reserve1: number;
  /** Pool LP fee, hundredths of a percent (`20` = 0.20%). */
  lp_fee: number | null;
  /** Protocol fee, hundredths of a percent. */
  protocol_fee: number;
  /** Referral fee, hundredths of a percent. */
  ref_fee: number;
  protocol_fee_address: string;
  collected_token0_protocol_fee: number;
  collected_token1_protocol_fee: number;
  lp_total_supply: number;
  lp_total_supply_usd: number | null;
  lp_price_usd: number | null;
  apy_1d: number | null;
  apy_7d: number | null;
  apy_30d: number | null;
  deprecated: boolean;
  /** Present only on wallet-scoped queries (`getPoolsForWallet`). */
  lp_balance?: number | null;
  lp_account_address?: string | null;
  lp_wallet_address?: string | null;
  token0_balance?: number | null;
  token1_balance?: number | null;
}

/** `GET /api/v1/pools-pairs` — a thin token0/token1 routing pair. */
export interface Pair {
  token0_address: string;
  token1_address: string;
}

// ---- transactions (the thing a wallet signs) ----------------------------

/** One TON Connect-shaped outgoing message, as built by the backend. */
export interface MessageData {
  /** Destination contract (router / jetton wallet). */
  to: string;
  /** Attached TON in nanotons (gas + forward amount). */
  amount: number;
  /** Base64 BOC payload. Pass through to the wallet unchanged. */
  payload: string | null;
}

/**
 * The output of every "build" endpoint (swap / provide / remove / create /
 * unlock). Feed it to `toTonConnectMessages()` and hand the result to
 * `tonConnectUI.sendTransaction(...)`.
 */
export interface TransactionData {
  /** Unix seconds after which the wallet must reject the transaction. */
  valid_until: number;
  messages: MessageData[];
}

// ---- swap ---------------------------------------------------------------

/** Numeric error codes returned (with HTTP 200) by the simulate endpoints. */
export enum DexErrorCode {
  POOL_NOT_FOUND = 21,
  INSUFFICIENT_LIQUIDITY = 22,
  WRONG_ACTION = 23,
}

/** Error envelope a simulate endpoint may return instead of a quote. */
export interface DexErrorPayload {
  type: "error";
  code: DexErrorCode;
  message: string;
}

export interface SimulateSwapParams {
  /** Token you give (its contract address). */
  offerAddress: string;
  /** Token you want (its contract address). */
  askAddress: string;
  /** Amount of the offer token, in smallest units. */
  units: UnitsInput;
  /** Slippage tolerance as a fraction, e.g. `0.01` = 1%. */
  slippageTolerance: number;
  /** Optional referral wallet that earns the pool's referral fee. */
  referralAddress?: string;
}

export interface SwapSimulation {
  offer_address: string;
  offer_units: number;
  ask_address: string;
  ask_units: number;
  min_ask_units: number;
  pool_address: string;
  router_address: string;
  fee_address: string;
  fee_percent: number;
  fee_units: number;
  price_impact: number;
  swap_rate: number;
  slippage_tolerance: number;
  /** Suggested forward-gas bounds (nanotons) for the build call. */
  fee_min: number;
  fee_max: number;
}

export interface BuildSwapParams {
  userWalletAddress: string;
  offerJettonAddress: string;
  /** Amount of the offer token, in smallest units. */
  offerAmount: UnitsInput;
  askJettonAddress: string;
  /** Minimum acceptable output, in smallest units (slippage floor). */
  minAskAmount: UnitsInput;
  /** Optional forward-gas override in nanotons. Defaults to the backend's. */
  forwardGasAmount?: UnitsInput;
  /** Optional dedupe id echoed into the on-chain message. */
  queryId?: number;
  referralAddress?: string;
}

// ---- liquidity ----------------------------------------------------------

export interface SimulateProvideLiquidityParams {
  /** Which side the user edited last — drives the auto-balanced amount. */
  lastUpdated: "token0" | "token1";
  token0Address: string;
  token1Address: string;
  token0Amount: UnitsInput;
  token1Amount: UnitsInput;
  slippageTolerance: number;
  userWalletAddress?: string;
  lpAccountAddress?: string;
}

/** Sub-flow the backend chose for a provide-liquidity action. */
export type ProvideLiquidityAction =
  | "provide"
  | "provide_second"
  | "provide_additional_amount"
  | "direct_add_provide"
  | "create";

export interface ProvideLiquiditySimulation {
  token0_amount: number;
  token1_amount: number;
  expected_tokens: number;
  min_expected_tokens: number;
  estimated_share_of_pool: number;
  action: ProvideLiquidityAction;
  lp_account_address: string | null;
  send_token_address: string | null;
  send_amount: number | null;
  fee_min: number;
  fee_max: number;
}

export interface ProvideLiquidityParams {
  userWalletAddress: string;
  token0Address: string;
  token1Address: string;
  token0Amount: UnitsInput;
  token1Amount: UnitsInput;
  /** Minimum LP tokens to mint (slippage floor), in smallest units. */
  minLpOut: UnitsInput;
}

export interface CompleteProvideLiquidityParams {
  userWalletAddress: string;
  tokenAddress: string;
  secondTokenAddress: string;
  tokenAmount: UnitsInput;
  minLpOut: UnitsInput;
}

export interface CompleteProvideLiquidityActivateParams {
  token0Amount: UnitsInput;
  token1Amount: UnitsInput;
  minLpOut: UnitsInput;
  lpAccountAddress: string;
}

export interface RemoveLiquidityParams {
  userWalletAddress: string;
  poolAddress: string;
  /** LP tokens to burn, in smallest units. */
  lpUnits: UnitsInput;
}

export interface CreatePoolParams {
  token0Address: string;
  token1Address: string;
  token0Units: UnitsInput;
  token1Units: UnitsInput;
}

export interface UnlockPoolParams {
  /** token0/token1 in the pool's stored order (read them off the Pool object). */
  token0Address: string;
  token1Address: string;
}
