// Pure cell builders for the Tegro Finance DEX (STON.fi V2.2 fork).
//
// Each function mirrors, field-for-field, the production backend's body
// builders (router_contract.py · jetton.py · lp_wallet_contract.py). The
// builders are pure: addresses in, a @ton/core Cell out. No I/O, no clock.
// The Router (router.ts) supplies resolved wallet addresses, the deadline,
// and gas amounts.
//
// Cross-checked for byte/hash equality against the Python originals — see
// tests/contracts.cells.test.ts.

import { beginCell, Address, type Cell } from "@ton/core";
import { OpCodes } from "./constants.js";

type Addr = Address | string;

const addr = (a: Addr): Address => (typeof a === "string" ? Address.parse(a) : a);

// ---- TEP-74 jetton transfer (0x0f8a7ea5) --------------------------------

export interface JettonTransferBodyParams {
  /** Destination owner (the router). */
  toAddress: Addr;
  jettonAmount: bigint;
  /** Forwarded to the destination with the notification. */
  forwardAmount?: bigint;
  /** Where excess gas is returned. Defaults to `toAddress` (matches backend). */
  responseAddress?: Addr;
  forwardPayload?: Cell | null;
  customPayload?: Cell | null;
  queryId?: number | bigint;
}

export function buildJettonTransferBody(p: JettonTransferBodyParams): Cell {
  return beginCell()
    .storeUint(OpCodes.JETTON_TRANSFER, 32)
    .storeUint(p.queryId ?? 0, 64)
    .storeCoins(p.jettonAmount)
    .storeAddress(addr(p.toAddress))
    .storeAddress(addr(p.responseAddress ?? p.toAddress))
    .storeMaybeRef(p.customPayload ?? null)
    .storeCoins(p.forwardAmount ?? 0n)
    .storeMaybeRef(p.forwardPayload ?? null)
    .endCell();
}

// ---- pTON/tgTON wrap (op::ton_transfer_tegro_v1, 0x4425460e) -------------

export interface PtonTransferBodyParams {
  tonAmount: bigint;
  refundAddress: Addr;
  forwardPayload: Cell;
  queryId?: number | bigint;
}

export function buildPtonTonTransferBody(p: PtonTransferBodyParams): Cell {
  return beginCell()
    .storeUint(OpCodes.PTON_TON_TRANSFER, 32)
    .storeUint(p.queryId ?? 0, 64)
    .storeCoins(p.tonAmount)
    .storeAddress(addr(p.refundAddress))
    .storeUint(1, 1) // forward_payload carried as a ref (Either right)
    .storeRef(p.forwardPayload)
    .endCell();
}

// ---- swap forward payload (op::cross_swap, 0x4048a461) -------------------

export interface SwapBodyParams {
  minAskAmount: bigint;
  /** The router's jetton wallet for the ask token. */
  askJettonWalletAddress: Addr;
  refundAddress: Addr;
  excessesAddress: Addr;
  /** Where the swapped tokens land. Defaults to the user (refundAddress's owner). */
  receiverAddress: Addr;
  /** Unix seconds the router rejects the swap after. */
  deadline: number;
  referralAddress?: Addr | null;
  referralValueBps?: number;
  customPayloadForwardGas?: bigint;
  refundForwardGas?: bigint;
}

export function buildSwapBody(p: SwapBodyParams): Cell {
  const inner = beginCell()
    .storeCoins(p.minAskAmount)
    .storeAddress(addr(p.receiverAddress))
    .storeCoins(p.customPayloadForwardGas ?? 0n)
    .storeUint(0, 1) // custom_payload maybe^Cell = none
    .storeCoins(p.refundForwardGas ?? 0n)
    .storeUint(0, 1) // refund_payload maybe^Cell = none
    .storeUint(p.referralValueBps ?? 0, 16)
    .storeAddress(p.referralAddress ? addr(p.referralAddress) : null)
    .endCell();

  return beginCell()
    .storeUint(OpCodes.CROSS_SWAP, 32)
    .storeAddress(addr(p.askJettonWalletAddress))
    .storeAddress(addr(p.refundAddress))
    .storeAddress(addr(p.excessesAddress))
    .storeUint(p.deadline, 64)
    .storeRef(inner)
    .endCell();
}

// ---- provide-liquidity forward payload (op::provide_lp, 0x54516d94) ------

export interface ProvideLiquidityBodyParams {
  minLpOutUnits: bigint;
  /** The router's jetton wallet for the OTHER (pair) token. */
  routerWalletAddress: Addr;
  refundAddress: Addr;
  excessesAddress: Addr;
  receiverAddress: Addr;
  deadline: number;
  bothPositive?: boolean;
  customPayloadForwardGas?: bigint;
}

export function buildProvideLiquidityBody(p: ProvideLiquidityBodyParams): Cell {
  const inner = beginCell()
    .storeCoins(p.minLpOutUnits)
    .storeAddress(addr(p.receiverAddress))
    .storeUint(p.bothPositive === false ? 0 : 1, 1)
    .storeCoins(p.customPayloadForwardGas ?? 0n)
    .storeUint(0, 1) // custom_payload maybe^Cell = none
    .endCell();

  return beginCell()
    .storeUint(OpCodes.PROVIDE_LIQUIDITY, 32)
    .storeAddress(addr(p.routerWalletAddress))
    .storeAddress(addr(p.refundAddress))
    .storeAddress(addr(p.excessesAddress))
    .storeUint(p.deadline, 64)
    .storeRef(inner)
    .endCell();
}

// ---- burn LP (op::burn, 0x595f07bc) → sent to the user's LP wallet -------

export interface BurnBodyParams {
  lpUnits: bigint;
  responseAddress: Addr;
  queryId?: number | bigint;
}

export function buildBurnBody(p: BurnBodyParams): Cell {
  return beginCell()
    .storeUint(OpCodes.BURN_LIQUIDITY, 32)
    .storeUint(p.queryId ?? 0, 64)
    .storeCoins(p.lpUnits)
    .storeAddress(addr(p.responseAddress))
    .endCell();
}

// ---- admin: unlock pool (op::update_pool_status, 0x2fd41e53) → router ----

export interface UpdatePoolStatusBodyParams {
  /** Router's jetton wallets for the pool's token0/token1, in stored order. */
  routerWallet0: Addr;
  routerWallet1: Addr;
  excessesRecipient: Addr;
  queryId?: number | bigint;
}

export function buildUpdatePoolStatusBody(p: UpdatePoolStatusBodyParams): Cell {
  return beginCell()
    .storeUint(OpCodes.UPDATE_POOL_STATUS, 32)
    .storeUint(p.queryId ?? 0, 64)
    .storeAddress(addr(p.routerWallet0))
    .storeAddress(addr(p.routerWallet1))
    .storeAddress(addr(p.excessesRecipient))
    .endCell();
}
