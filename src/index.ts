export {
  TegroFinanceClient,
  TegroFinanceApiError,
  TegroFinanceDexError,
  stringifyWithBigInt,
} from "./client.js";
export type { TegroFinanceClientOptions } from "./client.js";

export { toUnits, fromUnits, toBigIntUnits, applySlippage } from "./amounts.js";

export { toTonConnectMessages } from "./tonconnect.js";
export type {
  TonConnectMessage,
  TonConnectTransactionRequest,
} from "./tonconnect.js";

// On-chain layer: build swap/liquidity transactions client-side, without the
// Tegro backend (requires @ton/core + a JettonWalletResolver). See ./contracts.
export {
  TegroFinanceRouter,
  tonApiResolver,
  cachingResolver,
  JettonWalletResolutionError,
  OpCodes,
  Gas,
  TX_DEADLINE_SECONDS,
  PREPARED_TRANSACTION_LIFETIME_SECONDS,
  buildJettonTransferBody,
  buildPtonTonTransferBody,
  buildSwapBody,
  buildProvideLiquidityBody,
  buildBurnBody,
  buildUpdatePoolStatusBody,
} from "./contracts/index.js";
export type {
  RouterConfig,
  SwapTxParams,
  ProvideLiquidityTxParams,
  RemoveLiquidityTxParams,
  UnlockPoolTxParams,
  JettonWalletResolver,
  TonApiResolverOptions,
  JettonTransferBodyParams,
  PtonTransferBodyParams,
  SwapBodyParams,
  ProvideLiquidityBodyParams,
  BurnBodyParams,
  UpdatePoolStatusBodyParams,
} from "./contracts/index.js";

export { TON_NATIVE_ADDRESS, DexErrorCode } from "./types.js";
export type {
  UnitsInput,
  Asset,
  AssetMap,
  TokenData,
  Pool,
  Pair,
  MessageData,
  TransactionData,
  DexErrorPayload,
  SimulateSwapParams,
  SwapSimulation,
  BuildSwapParams,
  SimulateProvideLiquidityParams,
  ProvideLiquidityAction,
  ProvideLiquiditySimulation,
  ProvideLiquidityParams,
  CompleteProvideLiquidityParams,
  CompleteProvideLiquidityActivateParams,
  RemoveLiquidityParams,
  CreatePoolParams,
  UnlockPoolParams,
} from "./types.js";
