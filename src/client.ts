// Tegro Finance DEX HTTP client.
//
// Three groups of methods, all over the public REST API at tegro.finance:
//   • read   — pools / assets / token data (GET, no auth)
//   • quote  — simulate a swap or a liquidity provision (POST, no auth)
//   • build  — get a ready-to-sign TON Connect message list (POST, no auth)
//
// There is NO request signing and NO API key: the DEX is non-custodial and the
// user's wallet authorizes every state change. Read endpoints are public.

import { toBigIntUnits } from "./amounts.js";
import type {
  Asset,
  AssetMap,
  BuildSwapParams,
  CompleteProvideLiquidityActivateParams,
  CompleteProvideLiquidityParams,
  CreatePoolParams,
  DexErrorPayload,
  Pair,
  Pool,
  ProvideLiquidityParams,
  ProvideLiquiditySimulation,
  RemoveLiquidityParams,
  SimulateProvideLiquidityParams,
  SimulateSwapParams,
  SwapSimulation,
  TokenData,
  TransactionData,
  UnlockPoolParams,
} from "./types.js";

const DEFAULT_API_BASE = "https://api.tegro.finance";
const API_PREFIX = "/api/v1";

/** Linear trailing-slash trim (no regex — avoids quadratic backtracking). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

export interface TegroFinanceClientOptions {
  /**
   * API origin. Default `https://api.tegro.finance`. The path prefix
   * `/api/v1` is appended automatically. `https://tegro.finance` also works.
   */
  apiBase?: string;
  /** Inject a custom fetch (tests, proxies, retry wrappers). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. Set 0 to disable. */
  timeoutMs?: number;
}

export class TegroFinanceClient {
  private readonly apiBase: string;
  private readonly timeoutMs: number;

  constructor(opts: TegroFinanceClientOptions = {}) {
    this.apiBase = stripTrailingSlashes(opts.apiBase ?? DEFAULT_API_BASE);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private readonly fetchImpl: typeof fetch;

  // ---- read ------------------------------------------------------------

  /** All liquidity pools with reserves, fees and APYs. */
  getPools(): Promise<Pool[]> {
    return this.get<Pool[]>("/pools");
  }

  /** Pools that contain the given token (by contract address). */
  getPoolsForToken(tokenAddress: string): Promise<Pool[]> {
    return this.get<Pool[]>(`/pools/${encodeURIComponent(tokenAddress)}`);
  }

  /** Pools where the wallet holds an LP position (includes `lp_balance`). */
  getPoolsForWallet(walletAddress: string): Promise<Pool[]> {
    return this.get<Pool[]>(`/wallet/${encodeURIComponent(walletAddress)}/get_pools`);
  }

  /** All routing pairs (thin token0/token1 list). */
  getPoolsPairs(): Promise<Pair[]> {
    return this.get<Pair[]>("/pools-pairs");
  }

  /** Routing pairs reachable from a given token. */
  getPoolsPairsForToken(tokenAddress: string): Promise<Pair[]> {
    return this.get<Pair[]>(`/pools-pairs/for/${encodeURIComponent(tokenAddress)}`);
  }

  /** The token registry as a `contract_address` → {@link Asset} map. */
  getAssets(): Promise<AssetMap> {
    return this.get<AssetMap>("/assets");
  }

  /** The token registry as a flat array (convenience over {@link getAssets}). */
  async getAssetList(): Promise<Asset[]> {
    return Object.values(await this.getAssets());
  }

  /** Market snapshot for one token (price, holders, liquidity, trust score). */
  getTokenData(address: string): Promise<TokenData> {
    return this.get<TokenData>(`/tokens/${encodeURIComponent(address)}/data`);
  }

  /** Absolute URL of a token's cached logo (no fetch — use it as an `<img src>`). */
  tokenLogoUrl(address: string): string {
    return `${this.apiBase}${API_PREFIX}/tokens/logo/${encodeURIComponent(address)}`;
  }

  // ---- quote -----------------------------------------------------------

  /** Simulate a swap (exact-in): how much of `askAddress` you'd receive. */
  simulateSwap(params: SimulateSwapParams): Promise<SwapSimulation> {
    return this.postQuote<SwapSimulation>("/swap/simulate", {
      offer_address: params.offerAddress,
      ask_address: params.askAddress,
      units: toBigIntUnits(params.units),
      slippage_tolerance: params.slippageTolerance,
      ...(params.referralAddress && { referral_address: params.referralAddress }),
    });
  }

  /** Simulate a reverse swap (exact-out): how much of `offerAddress` you'd spend. */
  simulateReverseSwap(params: SimulateSwapParams): Promise<SwapSimulation> {
    return this.postQuote<SwapSimulation>("/reverse_swap/simulate", {
      offer_address: params.offerAddress,
      ask_address: params.askAddress,
      units: toBigIntUnits(params.units),
      slippage_tolerance: params.slippageTolerance,
      ...(params.referralAddress && { referral_address: params.referralAddress }),
    });
  }

  /** Simulate adding liquidity: expected LP tokens + the auto-balanced side. */
  simulateProvideLiquidity(
    params: SimulateProvideLiquidityParams,
  ): Promise<ProvideLiquiditySimulation> {
    return this.postQuote<ProvideLiquiditySimulation>("/dex/liquidity/provide/simulate", {
      last_updated: params.lastUpdated,
      token0_address: params.token0Address,
      token1_address: params.token1Address,
      token0_amount: toBigIntUnits(params.token0Amount),
      token1_amount: toBigIntUnits(params.token1Amount),
      slippage_tolerance: params.slippageTolerance,
      ...(params.userWalletAddress && { user_wallet_address: params.userWalletAddress }),
      ...(params.lpAccountAddress && { lp_account_address: params.lpAccountAddress }),
    });
  }

  // ---- build (returns a TON Connect-ready message list) ----------------

  /** Build a swap transaction for the wallet to sign. */
  buildSwap(params: BuildSwapParams): Promise<TransactionData> {
    return this.post<TransactionData>("/swap", {
      userWalletAddress: params.userWalletAddress,
      offerJettonAddress: params.offerJettonAddress,
      offerAmount: toBigIntUnits(params.offerAmount),
      askJettonAddress: params.askJettonAddress,
      minAskAmount: toBigIntUnits(params.minAskAmount),
      ...(params.forwardGasAmount !== undefined && {
        forwardGasAmount: toBigIntUnits(params.forwardGasAmount),
      }),
      ...(params.queryId !== undefined && { queryId: params.queryId }),
      ...(params.referralAddress && { referralAddress: params.referralAddress }),
    });
  }

  /** Build an add-liquidity transaction. */
  buildProvideLiquidity(params: ProvideLiquidityParams): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/liquidity/provide", {
      user_wallet_address: params.userWalletAddress,
      token0_address: params.token0Address,
      token1_address: params.token1Address,
      token0_amount: toBigIntUnits(params.token0Amount),
      token1_amount: toBigIntUnits(params.token1Amount),
      min_lp_out: toBigIntUnits(params.minLpOut),
    });
  }

  /** Build the second leg of a two-sided provide (sending the other token). */
  buildCompleteProvideLiquidity(
    params: CompleteProvideLiquidityParams,
  ): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/liquidity/provide_complete", {
      user_wallet_address: params.userWalletAddress,
      token_address: params.tokenAddress,
      second_token_address: params.secondTokenAddress,
      token_amount: toBigIntUnits(params.tokenAmount),
      min_lp_out: toBigIntUnits(params.minLpOut),
    });
  }

  /** Build the activation leg that mints LP from an already-funded LP account. */
  buildCompleteProvideLiquidityActivate(
    params: CompleteProvideLiquidityActivateParams,
  ): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/liquidity/provide_complete_activate", {
      token0_amount: toBigIntUnits(params.token0Amount),
      token1_amount: toBigIntUnits(params.token1Amount),
      min_lp_out: toBigIntUnits(params.minLpOut),
      lp_account_address: params.lpAccountAddress,
    });
  }

  /** Build a remove-liquidity (burn LP) transaction. */
  buildRemoveLiquidity(params: RemoveLiquidityParams): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/liquidity/remove", {
      user_wallet_address: params.userWalletAddress,
      pool_address: params.poolAddress,
      lp_units: toBigIntUnits(params.lpUnits),
    });
  }

  /** Build a create-pool transaction (first liquidity for a new pair). */
  buildCreatePool(params: CreatePoolParams): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/liquidity/create", {
      token0_address: params.token0Address,
      token1_address: params.token1Address,
      token0_units: toBigIntUnits(params.token0Units),
      token1_units: toBigIntUnits(params.token1Units),
    });
  }

  /** Build a pool-unlock transaction (protocol-admin signed `update_pool_status`). */
  buildUnlockPool(params: UnlockPoolParams): Promise<TransactionData> {
    return this.post<TransactionData>("/dex/pool/unlock", {
      token0_address: params.token0Address,
      token1_address: params.token1Address,
    });
  }

  // ---- internal --------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /**
   * POST a simulate endpoint that returns `{type:"error", code, message}` with
   * HTTP 200 instead of a quote. Detects that envelope and throws a typed
   * {@link TegroFinanceDexError} so the caller never mistakes it for a quote.
   */
  private async postQuote<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const out = await this.request<T | DexErrorPayload>("POST", path, body);
    if (out && typeof out === "object" && (out as DexErrorPayload).type === "error") {
      const e = out as DexErrorPayload;
      throw new TegroFinanceDexError(e.message, e.code, e);
    }
    return out as T;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiBase}${API_PREFIX}${path}`;
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer =
      controller && setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? stringifyWithBigInt(body) : undefined,
        signal: controller?.signal,
      });
    } catch (err) {
      throw new TegroFinanceApiError(
        controller?.signal.aborted ? "request timed out" : String((err as Error)?.message ?? err),
        0,
        undefined,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw new TegroFinanceApiError(`non-JSON response (HTTP ${res.status})`, res.status, text);
    }

    if (!res.ok) {
      const detail =
        (parsed as { detail?: unknown })?.detail != null
          ? JSON.stringify((parsed as { detail?: unknown }).detail)
          : `HTTP ${res.status}`;
      throw new TegroFinanceApiError(String(detail), res.status, parsed);
    }

    return parsed as T;
  }
}

/**
 * Serialize a body that may contain `bigint` values as a JSON document with
 * unquoted integer literals — so token units above 2**53 reach the API with
 * full precision (plain `JSON.stringify` throws on bigint).
 */
export function stringifyWithBigInt(body: Record<string, unknown>): string {
  const SENTINEL = "__tegro_bigint__";
  const json = JSON.stringify(body, (_k, v) =>
    typeof v === "bigint" ? `${SENTINEL}${v.toString()}${SENTINEL}` : v,
  );
  return json.replace(new RegExp(`"${SENTINEL}(-?\\d+)${SENTINEL}"`, "g"), "$1");
}

/** Thrown on transport failure or a non-2xx HTTP response. */
export class TegroFinanceApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public raw: unknown,
  ) {
    super(`tegro_finance_api_error:${message}`);
    this.name = "TegroFinanceApiError";
  }
}

/** Thrown when a simulate endpoint returns a `{type:"error"}` envelope. */
export class TegroFinanceDexError extends Error {
  constructor(
    message: string,
    public code: number,
    public raw: DexErrorPayload,
  ) {
    super(`tegro_finance_dex_error:${code}:${message}`);
    this.name = "TegroFinanceDexError";
  }
}
