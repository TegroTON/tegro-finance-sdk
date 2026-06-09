// On-chain Router — builds swap / liquidity / admin transactions entirely
// client-side, mirroring the production backend's TonDexRouterContract
// (router_contract.py · lp_wallet_contract.py). It resolves jetton wallet
// addresses through a {@link JettonWalletResolver} (your RPC) and assembles a
// TON Connect request — no Tegro backend in the loop.
//
// This is the "STON.fi-grade" path: integrators that don't want to depend on
// our API build the exact same transaction the wallet would otherwise get from
// /api/v1/swap, with byte-identical message bodies (verified by hash against
// the backend — see tests/contracts.cells.test.ts).

import {
  buildBurnBody,
  buildJettonTransferBody,
  buildProvideLiquidityBody,
  buildPtonTonTransferBody,
  buildSwapBody,
  buildUpdatePoolStatusBody,
} from "./cells.js";
import { Gas, PREPARED_TRANSACTION_LIFETIME_SECONDS, TX_DEADLINE_SECONDS } from "./constants.js";
import type { JettonWalletResolver } from "./provider.js";
import { TON_NATIVE_ADDRESS, type UnitsInput } from "../types.js";
import { toBigIntUnits } from "../amounts.js";
import type { TonConnectMessage, TonConnectTransactionRequest } from "../tonconnect.js";

export interface RouterConfig {
  /** DEX router contract address. */
  routerAddress: string;
  /** pTON / tgTON wrapper jetton master address (the router's TON proxy). */
  proxyTonAddress: string;
  /** Resolver for `get_wallet_address` lookups (your RPC / tonApiResolver). */
  resolver: JettonWalletResolver;
}

export interface SwapTxParams {
  userWalletAddress: string;
  offerJettonAddress: string;
  offerAmount: UnitsInput;
  askJettonAddress: string;
  /** Slippage floor in smallest units (use `applySlippage`). */
  minAskAmount: UnitsInput;
  referralAddress?: string;
  /** Override the forward-gas (nanotons). Defaults to the backend's per-leg value. */
  forwardGasAmount?: UnitsInput;
  queryId?: number;
}

export interface ProvideLiquidityTxParams {
  userWalletAddress: string;
  token0Address: string;
  token1Address: string;
  token0Amount: UnitsInput;
  token1Amount: UnitsInput;
  /** Slippage floor on LP tokens minted, in smallest units. */
  minLpOutUnits: UnitsInput;
  queryId?: number;
}

export interface RemoveLiquidityTxParams {
  userWalletAddress: string;
  /** The pool address (it is the LP jetton minter). */
  poolAddress: string;
  /** LP tokens to burn, in smallest units. */
  lpUnits: UnitsInput;
  queryId?: number;
}

export interface UnlockPoolTxParams {
  /** token0/token1 in the pool's stored order. */
  token0Address: string;
  token1Address: string;
  /** Where router excesses are returned (usually the admin wallet). */
  excessesRecipient: string;
  queryId?: number;
}

export class TegroFinanceRouter {
  private readonly router: string;
  private readonly pton: string;
  private readonly resolver: JettonWalletResolver;

  constructor(cfg: RouterConfig) {
    this.router = cfg.routerAddress;
    this.pton = cfg.proxyTonAddress;
    this.resolver = cfg.resolver;
  }

  private isTon(a: string): boolean {
    return a === TON_NATIVE_ADDRESS;
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }

  private deadline(): number {
    return this.now() + TX_DEADLINE_SECONDS;
  }

  private request(messages: TonConnectMessage[]): TonConnectTransactionRequest {
    return {
      validUntil: this.now() + PREPARED_TRANSACTION_LIFETIME_SECONDS,
      messages,
    };
  }

  // ---- swap ------------------------------------------------------------

  async getSwapTxParams(p: SwapTxParams): Promise<TonConnectTransactionRequest> {
    const offerAmount = toBigIntUnits(p.offerAmount);
    const minAsk = toBigIntUnits(p.minAskAmount);
    const queryId = p.queryId ?? 0;
    const deadline = this.deadline();
    const user = p.userWalletAddress;

    // Native TON offer leg: wrap via op::ton_transfer to the router's pTON wallet.
    if (this.isTon(p.offerJettonAddress)) {
      const askJetton = this.isTon(p.askJettonAddress) ? this.pton : p.askJettonAddress;
      const forwardGas = p.forwardGasAmount !== undefined
        ? toBigIntUnits(p.forwardGasAmount)
        : Gas.SWAP_TON_TO_JETTON_FORWARD;

      const [proxyTonWallet, askJettonWallet] = await Promise.all([
        this.resolver.getWalletAddress(this.pton, this.router),
        this.resolver.getWalletAddress(askJetton, this.router),
      ]);

      const swapBody = buildSwapBody({
        minAskAmount: minAsk,
        askJettonWalletAddress: askJettonWallet,
        refundAddress: user,
        excessesAddress: user,
        receiverAddress: user,
        deadline,
        referralAddress: p.referralAddress ?? null,
      });
      const payload = buildPtonTonTransferBody({
        tonAmount: offerAmount,
        refundAddress: user,
        forwardPayload: swapBody,
        queryId,
      });
      return this.request([
        {
          address: proxyTonWallet,
          amount: (forwardGas + offerAmount).toString(),
          payload: payload.toBoc().toString("base64"),
        },
      ]);
    }

    // Jetton offer leg (jetton→jetton or jetton→TON).
    const askJetton = this.isTon(p.askJettonAddress) ? this.pton : p.askJettonAddress;
    const askIsTon = askJetton === this.pton;
    const gasAmount = askIsTon ? Gas.SWAP_JETTON_TO_TON : Gas.SWAP;
    const forwardGas = p.forwardGasAmount !== undefined
      ? toBigIntUnits(p.forwardGasAmount)
      : askIsTon
        ? Gas.SWAP_JETTON_TO_TON_FORWARD
        : Gas.SWAP_FORWARD;

    const [offerJettonWallet, askJettonWallet] = await Promise.all([
      this.resolver.getWalletAddress(p.offerJettonAddress, user),
      this.resolver.getWalletAddress(askJetton, this.router),
    ]);

    const swapBody = buildSwapBody({
      minAskAmount: minAsk,
      askJettonWalletAddress: askJettonWallet,
      refundAddress: user,
      excessesAddress: user,
      receiverAddress: user,
      deadline,
      referralAddress: p.referralAddress ?? null,
    });
    const payload = buildJettonTransferBody({
      toAddress: this.router,
      jettonAmount: offerAmount,
      responseAddress: user,
      forwardAmount: forwardGas,
      forwardPayload: swapBody,
      queryId,
    });
    return this.request([
      {
        address: offerJettonWallet,
        amount: gasAmount.toString(),
        payload: payload.toBoc().toString("base64"),
      },
    ]);
  }

  // ---- liquidity -------------------------------------------------------

  /** Add liquidity. Emits one message per non-zero side (mirrors the backend). */
  async getProvideLiquidityTxParams(
    p: ProvideLiquidityTxParams,
  ): Promise<TonConnectTransactionRequest> {
    const amount0 = toBigIntUnits(p.token0Amount);
    const amount1 = toBigIntUnits(p.token1Amount);
    const minLp = toBigIntUnits(p.minLpOutUnits);

    const messages: TonConnectMessage[] = [];
    if (amount0 > 0n) {
      messages.push(
        await this.buildProvideMessage(p.userWalletAddress, p.token0Address, p.token1Address, amount0, minLp, p.queryId),
      );
    }
    if (amount1 > 0n) {
      messages.push(
        await this.buildProvideMessage(p.userWalletAddress, p.token1Address, p.token0Address, amount1, minLp, p.queryId),
      );
    }
    if (messages.length === 0) {
      throw new Error("getProvideLiquidityTxParams: both amounts are zero");
    }
    return this.request(messages);
  }

  /**
   * Create a new pool: identical to a two-sided provide on a pair that has no
   * pool yet — the router deploys it. Pass the initial reserves as the amounts.
   */
  getCreatePoolTxParams(p: ProvideLiquidityTxParams): Promise<TonConnectTransactionRequest> {
    return this.getProvideLiquidityTxParams(p);
  }

  private async buildProvideMessage(
    user: string,
    sendToken: string,
    pairTokenRaw: string,
    units: bigint,
    minLp: bigint,
    queryId = 0,
  ): Promise<TonConnectMessage> {
    const deadline = this.deadline();
    const pairToken = this.isTon(pairTokenRaw) ? this.pton : pairTokenRaw;

    // Native TON side: wrap via op::ton_transfer to the router's pTON wallet.
    if (this.isTon(sendToken)) {
      const [proxyTonWallet, routerPairWallet] = await Promise.all([
        this.resolver.getWalletAddress(this.pton, this.router),
        this.resolver.getWalletAddress(pairToken, this.router),
      ]);
      const body = buildProvideLiquidityBody({
        minLpOutUnits: minLp,
        routerWalletAddress: routerPairWallet,
        refundAddress: user,
        excessesAddress: user,
        receiverAddress: user,
        deadline,
        bothPositive: true,
      });
      const payload = buildPtonTonTransferBody({
        tonAmount: units,
        refundAddress: user,
        forwardPayload: body,
        queryId,
      });
      return {
        address: proxyTonWallet,
        amount: (Gas.PROVIDE_LP_TON_FORWARD + units).toString(),
        payload: payload.toBoc().toString("base64"),
      };
    }

    // Jetton side.
    const [sendJettonWallet, routerPairWallet] = await Promise.all([
      this.resolver.getWalletAddress(sendToken, user),
      this.resolver.getWalletAddress(pairToken, this.router),
    ]);
    const body = buildProvideLiquidityBody({
      minLpOutUnits: minLp,
      routerWalletAddress: routerPairWallet,
      refundAddress: user,
      excessesAddress: user,
      receiverAddress: user,
      deadline,
      bothPositive: true,
    });
    const payload = buildJettonTransferBody({
      toAddress: this.router,
      jettonAmount: units,
      responseAddress: user,
      forwardAmount: Gas.PROVIDE_LP_JETTON_FORWARD,
      forwardPayload: body,
      queryId,
    });
    return {
      address: sendJettonWallet,
      amount: Gas.PROVIDE_LP.toString(),
      payload: payload.toBoc().toString("base64"),
    };
  }

  /** Remove liquidity by burning LP tokens (sends op::burn to the user's LP wallet). */
  async getRemoveLiquidityTxParams(
    p: RemoveLiquidityTxParams,
  ): Promise<TonConnectTransactionRequest> {
    const lpUnits = toBigIntUnits(p.lpUnits);
    // The pool is the LP jetton minter → the user's LP wallet is its wallet.
    const lpWallet = await this.resolver.getWalletAddress(p.poolAddress, p.userWalletAddress);
    const payload = buildBurnBody({
      lpUnits,
      responseAddress: p.userWalletAddress,
      queryId: p.queryId ?? 0,
    });
    return this.request([
      {
        address: lpWallet,
        amount: Gas.BURN_LIQUIDITY.toString(),
        payload: payload.toBoc().toString("base64"),
      },
    ]);
  }

  // ---- admin -----------------------------------------------------------

  /** Unlock a pool (protocol-admin signed op::update_pool_status → router). */
  async getUnlockPoolTxParams(p: UnlockPoolTxParams): Promise<TonConnectTransactionRequest> {
    const t0 = this.isTon(p.token0Address) ? this.pton : p.token0Address;
    const t1 = this.isTon(p.token1Address) ? this.pton : p.token1Address;
    const [routerWallet0, routerWallet1] = await Promise.all([
      this.resolver.getWalletAddress(t0, this.router),
      this.resolver.getWalletAddress(t1, this.router),
    ]);
    const payload = buildUpdatePoolStatusBody({
      routerWallet0,
      routerWallet1,
      excessesRecipient: p.excessesRecipient,
      queryId: p.queryId ?? 0,
    });
    return this.request([
      {
        address: this.router,
        amount: Gas.UPDATE_POOL_STATUS.toString(),
        payload: payload.toBoc().toString("base64"),
      },
    ]);
  }
}
