// Tegro liquid staking (stgTON) HTTP client.
//
// Stake TON → receive stgTON, a liquid appreciating-rate token. Exit via a
// 72-hour withdrawal voucher. The shape mirrors the DEX client:
//   • read   — pools / live rate (GET, no auth)
//   • build  — stake / unstake / claim → a ready-to-sign TON Connect message
//   • read*  — pending withdrawal vouchers (GET, auth)
//
// Two differences from the DEX client, both deliberate:
//   1. Builder endpoints (stake/unstake/claim) and `getWithdrawals` are
//      AUTHENTICATED with a session cookie named `token`, obtained by the
//      integrator authenticating the wallet via TON Connect. In a browser dApp
//      the cookie travels automatically (`credentials: "include"`); on a server
//      pass it explicitly via `sessionToken`.
//   2. The default origin is `https://tegro.finance` (NOT `api.tegro.finance`).
//      The session cookie is scoped to `tegro.finance`; calling a different
//      origin would silently drop it in the browser. Override only if you proxy
//      the API under the same origin as your auth.
//
// The API never holds keys or moves funds — the user's WALLET signs every
// state change. Source: TegroTON/ton-gram-staking-docs (openapi.yaml, docs/api.md).

import { toBigIntUnits } from "./amounts.js";
import { TegroFinanceApiError, stringifyWithBigInt } from "./client.js";
import type { Asset, TransactionData, UnitsInput } from "./types.js";

/** Fetch credentials mode (DOM-free alias — the SDK targets lib ES2022). */
export type CredentialsMode = "omit" | "same-origin" | "include";

const DEFAULT_API_BASE = "https://tegro.finance";
const API_PREFIX = "/api/v1";
const STAKING_PREFIX = "/liquid-staking";

/** Linear trailing-slash trim (no regex — avoids quadratic backtracking). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

// ---- types --------------------------------------------------------------

/**
 * One entry of `GET /api/v1/liquid-staking/pools`. Shape verified 2026-06-24
 * against the live backend.
 *
 * Pass the staked token's master — `out_asset.contract_address` — as the
 * `masterAddress` to the build/read methods (the only `is_active` pool today is
 * stgTON, `EQC-DUl20SfQFVH34cky8N76la1K0Uu5UWjel5IEn7mjIrfc`).
 */
export interface StakingPool {
  /** The pool account (non-bounceable UQ form of the master). */
  address: string;
  /** The staked-in asset (e.g. TON). */
  in_asset: Asset;
  /** The liquid receipt asset, whose `contract_address` is the master to call. */
  out_asset: Asset;
  /**
   * Annual percentage yield as a **percent number** — `16.97` means 16.97%
   * (NOT a fraction). Divide by 100 before multiplying a balance.
   */
  apy: number;
  /** Flat gas/forward hint attached to the stake message, in nanoTON. */
  fees: number;
  /** Minimum stake accepted, in the in-asset's smallest units. */
  min_offer_amount: number;
  is_active: boolean;
}

/**
 * `GET /api/v1/liquid-staking/pool/{address}/data` — the live exchange rate.
 *
 * `price` is the stgTON→TON rate scaled by 1e9: `price / 1e9` TON per stgTON.
 * It only ever appreciates (staking rewards accrue into it). Use
 * {@link stgTonToTon} / {@link tonToStgTon} to convert with it.
 */
export interface StakingPoolData {
  address: string;
  /** stgTON→TON rate, 9-decimal fixed point (`1001005223` = 1.001005223). */
  price: number;
  is_active: boolean;
}

/** One pending exit, from `GET /api/v1/liquid-staking/pool/{address}/withdrawals`. */
export interface StakingWithdrawal {
  /** The per-withdrawal voucher contract that holds your payout. */
  voucher_address: string;
  /** Payout in nanoTON. */
  amount: number;
  /** Unix seconds after which the voucher is claimable (stake + 72h). */
  claim_after: number;
  /** True once `claim_after` has passed and the voucher can be claimed. */
  claimable: boolean;
}

export interface BuildStakeParams {
  /** The staking master (stgTON jetton master). */
  masterAddress: string;
  /** TON to stake, in nanoTON (smallest units). */
  offerAmount: UnitsInput;
}

export interface BuildUnstakeParams {
  masterAddress: string;
  /** stgTON to burn, in nano-stgTON (smallest units). */
  sharesAmount: UnitsInput;
}

export interface BuildClaimParams {
  masterAddress: string;
  /** A matured voucher from {@link TegroFinanceStakingClient.getWithdrawals}. */
  voucherAddress: string;
}

export interface TegroFinanceStakingClientOptions {
  /**
   * API origin. Default `https://tegro.finance` — the origin the session cookie
   * is scoped to. The path prefix `/api/v1` is appended automatically.
   */
  apiBase?: string;
  /**
   * Session token for the `token` cookie, for server-side (non-browser) calls
   * to the authenticated endpoints. In a browser dApp leave this unset and rely
   * on the cookie set during TON Connect auth. Can be updated later with
   * {@link TegroFinanceStakingClient.setSessionToken}.
   */
  sessionToken?: string;
  /**
   * Fetch credentials mode. Default `"include"` so the browser sends the
   * `token` cookie to the (same-origin) API. Harmless on the server.
   */
  credentials?: CredentialsMode;
  /** Inject a custom fetch (tests, proxies, retry wrappers). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. Set 0 to disable. */
  timeoutMs?: number;
}

/** Thrown by an authenticated staking method when no session is available. */
export class TegroFinanceStakingAuthError extends Error {
  constructor(message: string) {
    super(`tegro_finance_staking_auth_error:${message}`);
    this.name = "TegroFinanceStakingAuthError";
  }
}

export class TegroFinanceStakingClient {
  private readonly apiBase: string;
  private readonly credentials: CredentialsMode;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionToken: string | undefined;

  constructor(opts: TegroFinanceStakingClientOptions = {}) {
    this.apiBase = stripTrailingSlashes(opts.apiBase ?? DEFAULT_API_BASE);
    this.sessionToken = opts.sessionToken;
    this.credentials = opts.credentials ?? "include";
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /**
   * Set (or clear) the server-side session token after the wallet authenticates.
   * Pass `null` to forget it. Ignored for browser cookie auth.
   */
  setSessionToken(token: string | null): void {
    this.sessionToken = token ?? undefined;
  }

  // ---- read (open) -----------------------------------------------------

  /** All liquid-staking pools (`address`, `apy`, `min_offer_amount`, `is_active`). */
  getPools(): Promise<StakingPool[]> {
    return this.get<StakingPool[]>("/pools");
  }

  /** Live rate and status for one pool (its `price` is the stgTON→TON rate). */
  getPoolData(masterAddress: string): Promise<StakingPoolData> {
    return this.get<StakingPoolData>(`/pool/${encodeURIComponent(masterAddress)}/data`);
  }

  // ---- read (auth) -----------------------------------------------------

  /**
   * The authenticated wallet's pending withdrawal vouchers, each with its
   * `claim_after` timer and a `claimable` flag. Requires a session.
   */
  getWithdrawals(masterAddress: string): Promise<StakingWithdrawal[]> {
    return this.get<StakingWithdrawal[]>(
      `/pool/${encodeURIComponent(masterAddress)}/withdrawals`,
      true,
    );
  }

  // ---- build (returns a TON Connect-ready message list, auth) -----------

  /**
   * Build a stake transaction: sends TON to the master, which mints stgTON to
   * your st-wallet. Feed the result to `toTonConnectMessages()`.
   */
  buildStake(params: BuildStakeParams): Promise<TransactionData> {
    return this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/stake`,
      { offer_amount: toBigIntUnits(params.offerAmount) },
    );
  }

  /**
   * Build an unstake transaction: burns stgTON via your st-wallet; the master
   * issues a 72-hour withdrawal voucher (then claim it after it matures).
   */
  buildUnstake(params: BuildUnstakeParams): Promise<TransactionData> {
    return this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/unstake`,
      { shares_amount: toBigIntUnits(params.sharesAmount) },
    );
  }

  /**
   * Build a claim transaction for a matured voucher. The server verifies
   * on-chain that the voucher is yours, matured (72h) and unclaimed first.
   */
  buildClaim(params: BuildClaimParams): Promise<TransactionData> {
    return this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/claim`,
      { voucher_address: params.voucherAddress },
    );
  }

  // ---- internal --------------------------------------------------------

  private get<T>(path: string, auth = false): Promise<T> {
    return this.request<T>("GET", path, undefined, auth);
  }

  private post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body, true);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    auth: boolean,
  ): Promise<T> {
    const url = `${this.apiBase}${API_PREFIX}${STAKING_PREFIX}${path}`;
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller && setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    // Server-side cookie auth: a browser silently ignores a manual Cookie header
    // and sends the real cookie via `credentials: "include"` instead.
    if (auth && this.sessionToken) headers["Cookie"] = `token=${this.sessionToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body ? stringifyWithBigInt(body) : undefined,
        credentials: this.credentials,
        signal: controller?.signal,
      });
    } catch (err) {
      throw new TegroFinanceApiError(
        controller?.signal.aborted
          ? "request timed out"
          : String((err as Error)?.message ?? err),
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
      if (auth && (res.status === 401 || res.status === 403)) {
        throw new TegroFinanceStakingAuthError(
          this.sessionToken || this.credentials === "include"
            ? `session rejected (HTTP ${res.status}) — re-authenticate the wallet`
            : `no session — authenticate the wallet (TON Connect) or pass sessionToken`,
        );
      }
      const detail =
        (parsed as { detail?: unknown })?.detail != null
          ? JSON.stringify((parsed as { detail?: unknown }).detail)
          : `HTTP ${res.status}`;
      throw new TegroFinanceApiError(String(detail), res.status, parsed);
    }

    return parsed as T;
  }
}

// ---- rate helpers -------------------------------------------------------
//
// stgTON and TON are both 9-decimal. `price` from getPoolData() is the
// stgTON→TON rate in 1e9 fixed point. These convert between the two using
// exact BigInt math (floored). They are DISPLAY ESTIMATES of the headline
// rate only — they exclude the 0.5% redeem (unstake) fee and gas, and the
// on-chain contract is the sole authority on the settled amount. Never use
// them as a slippage floor or a settlement guarantee.

const RATE_SCALE = 1_000_000_000n;

/** Estimate the TON you'd get for `stgTonUnits` stgTON at the given pool `price`. */
export function stgTonToTon(stgTonUnits: UnitsInput, price: UnitsInput): bigint {
  return (toBigIntUnits(stgTonUnits) * toBigIntUnits(price)) / RATE_SCALE;
}

/** Estimate the stgTON minted for `tonUnits` TON at the given pool `price`. */
export function tonToStgTon(tonUnits: UnitsInput, price: UnitsInput): bigint {
  const p = toBigIntUnits(price);
  if (p <= 0n) throw new RangeError(`pool price must be positive, got ${price}`);
  return (toBigIntUnits(tonUnits) * RATE_SCALE) / p;
}
