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
//      AUTHENTICATED with a session cookie named `tegro-dex`, obtained by the
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

import { Address } from "@ton/core";
import { toBigIntUnits } from "./amounts.js";
import { TegroFinanceApiError, stringifyWithBigInt } from "./client.js";
import type { Asset, MessageData, TransactionData, UnitsInput } from "./types.js";

/** Fetch credentials mode (DOM-free alias — the SDK targets lib ES2022). */
export type CredentialsMode = "omit" | "same-origin" | "include";

const DEFAULT_API_BASE = "https://tegro.finance";
const API_PREFIX = "/api/v1";
const STAKING_PREFIX = "/liquid-staking";
/** Session cookie name the production backend reads (jwt.py `TOKEN_KEY`). */
const DEFAULT_COOKIE_NAME = "tegro-dex";

/**
 * Hard ceiling on the *gas* a builder may attach on top of the staked amount,
 * in nanoTON (2 TON). A compromised/MITM'd API returning a tx that drains far
 * more than the user asked for is rejected before it can reach the wallet.
 */
const MAX_BUILD_GAS = 2_000_000_000n;

/** Reject a far-future `valid_until` (replay window) — 1h past the issue time. */
const MAX_VALID_UNTIL_AHEAD_SECS = 3600;

/** Linear trailing-slash trim (no regex — avoids quadratic backtracking). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

/** Normalize a {@link UnitsInput} and require it to be strictly positive. */
function positiveUnits(value: UnitsInput, field: string): bigint {
  const v = toBigIntUnits(value);
  if (v <= 0n) throw new RangeError(`${field} must be a positive amount, got ${v}`);
  return v;
}

/** Same TON account regardless of bounceable/testnet flag form (EQ vs UQ). */
function sameAccount(a: string, b: string): boolean {
  try {
    return Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

/**
 * Validate a cookie name as an RFC 6265 token so it can't smuggle cookie syntax.
 * Exported for reuse by the auth client; not part of the public package surface.
 */
export function assertCookieName(name: string): void {
  // token = 1*<any CHAR except CTLs or separators>. Reject empty / illegal chars.
  if (!name) throw new Error("tegro_finance_staking: cookieName must be non-empty");
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      "!#$%&'*+-.^_`|~".indexOf(name[i]) !== -1;
    if (!ok) throw new Error(`tegro_finance_staking: illegal character in cookieName: ${name}`);
  }
}

/** True if `s` parses as a TON address in any friendly/raw form. */
function isAddress(s: string): boolean {
  try {
    Address.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard a session token before it goes into a `Cookie` header. Rejects an
 * `https`-less origin and any control/delimiter character (`;`, CR, LF, etc.)
 * that could split the header. Exported for reuse by the auth client; not part
 * of the public package surface.
 */
export function assertUsableToken(token: string, apiBase: string): void {
  // Scheme is case-insensitive (`HTTP://` ≡ `http://`); require https explicitly
  // so a plaintext or scheme-less base can never carry the token.
  if (!apiBase.toLowerCase().startsWith("https://")) {
    throw new Error(
      "tegro_finance_staking: sessionToken requires an https:// apiBase (got " + apiBase + ")",
    );
  }
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x3b /* ; */) {
      throw new Error("tegro_finance_staking: sessionToken contains an illegal character");
    }
  }
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
   * Session token for the `tegro-dex` cookie, for server-side (non-browser) calls
   * to the authenticated endpoints. In a browser dApp leave this unset and rely
   * on the cookie set during TON Connect auth. Can be updated later with
   * {@link TegroFinanceStakingClient.setSessionToken}.
   */
  sessionToken?: string;
  /**
   * Fetch credentials mode. Default `"include"` so the browser sends the
   * session cookie to the (same-origin) API. Harmless on the server.
   */
  credentials?: CredentialsMode;
  /**
   * Name of the session cookie the backend reads. Default `"tegro-dex"` (the
   * production value). Only override if you front the API with a proxy that
   * renames it.
   */
  cookieName?: string;
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

/**
 * Thrown when a builder's response does not match the request the SDK made —
 * the last line of defense before a transaction reaches the wallet to sign.
 * A wrong destination, an attached amount outside the requested bounds, a
 * non-integer/oversized amount, or a malformed `valid_until` all trip this.
 */
export class TegroFinanceStakingValidationError extends Error {
  constructor(message: string) {
    super(`tegro_finance_staking_validation_error:${message}`);
    this.name = "TegroFinanceStakingValidationError";
  }
}

export class TegroFinanceStakingClient {
  private readonly apiBase: string;
  private readonly credentials: CredentialsMode;
  private readonly cookieName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionToken: string | undefined;

  constructor(opts: TegroFinanceStakingClientOptions = {}) {
    this.apiBase = stripTrailingSlashes(opts.apiBase ?? DEFAULT_API_BASE);
    this.sessionToken = opts.sessionToken;
    this.credentials = opts.credentials ?? "include";
    this.cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
    assertCookieName(this.cookieName);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetch ?? fetch;
    // The session token is a bearer-equivalent credential put in a Cookie header
    // and sent verbatim to `apiBase`. Refuse plaintext transport or an injectable token.
    if (this.sessionToken) assertUsableToken(this.sessionToken, this.apiBase);
  }

  /**
   * Set (or clear) the server-side session token after the wallet authenticates.
   * Pass `null` to forget it. Ignored for browser cookie auth.
   */
  setSessionToken(token: string | null): void {
    if (token) assertUsableToken(token, this.apiBase);
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
   *
   * The response is validated before it is returned: every attached message
   * must be addressed to `masterAddress`, and the total attached TON must fall
   * within `[offerAmount, offerAmount + 2 TON gas]`. A backend that tries to
   * redirect or inflate the transfer is rejected with a
   * {@link TegroFinanceStakingValidationError} — the wallet never sees it.
   */
  async buildStake(params: BuildStakeParams): Promise<TransactionData> {
    const offer = positiveUnits(params.offerAmount, "offerAmount");
    const tx = await this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/stake`,
      { offer_amount: offer },
    );
    return this.validateBuildResponse(tx, {
      kind: "stake",
      masterAddress: params.masterAddress,
      offer,
      allowedDest: [params.masterAddress],
    });
  }

  /**
   * Build an unstake transaction: burns stgTON via your st-wallet; the master
   * issues a 72-hour withdrawal voucher (then claim it after it matures). The
   * burn rides in the message payload, so only gas (≤ 2 TON) may be attached —
   * a response attaching more is rejected.
   *
   * Trust-boundary note: the burn targets the caller's own st-wallet, whose
   * address the SDK cannot derive here (the backend knows the wallet from the
   * session). So unstake destination is NOT bound — only the attached gas is
   * capped. The principal is the stgTON burned via the payload, never native
   * value, so a compromised backend's worst case is misdirected gas (≤ 2 TON)
   * plus a payload the wallet still shows for approval. Always review the tx in
   * the wallet before signing.
   */
  async buildUnstake(params: BuildUnstakeParams): Promise<TransactionData> {
    const shares = positiveUnits(params.sharesAmount, "sharesAmount");
    const tx = await this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/unstake`,
      { shares_amount: shares },
    );
    return this.validateBuildResponse(tx, { kind: "unstake", masterAddress: params.masterAddress });
  }

  /**
   * Build a claim transaction for a matured voucher. The server verifies
   * on-chain that the voucher is yours, matured (72h) and unclaimed first.
   * Gas-carrying messages must target the requested voucher (or the master),
   * and only gas (≤ 2 TON) may be attached.
   */
  async buildClaim(params: BuildClaimParams): Promise<TransactionData> {
    if (!params.voucherAddress || !isAddress(params.voucherAddress)) {
      throw new RangeError(`voucherAddress is not a valid TON address: ${params.voucherAddress}`);
    }
    const tx = await this.post<TransactionData>(
      `/pool/${encodeURIComponent(params.masterAddress)}/claim`,
      { voucher_address: params.voucherAddress },
    );
    return this.validateBuildResponse(tx, {
      kind: "claim",
      masterAddress: params.masterAddress,
      allowedDest: [params.voucherAddress, params.masterAddress],
    });
  }

  // ---- internal --------------------------------------------------------

  /**
   * Fail-closed check that a builder's response matches the request, BEFORE it
   * can reach the wallet. The SDK trusts the backend to assemble the payload,
   * but binds the money-carrying envelope (destination + attached nanoTON) to
   * what the caller asked for, so a compromised/MITM'd API can neither redirect
   * the funds nor inflate the amount.
   */
  private validateBuildResponse(
    tx: TransactionData,
    ctx: {
      kind: "stake" | "unstake" | "claim";
      masterAddress: string;
      offer?: bigint;
      /** Destinations a money-carrying message may target. Undefined = unbound. */
      allowedDest?: string[];
    },
  ): TransactionData {
    const bad = (m: string): never => {
      throw new TegroFinanceStakingValidationError(`${ctx.kind}: ${m}`);
    };

    if (!tx || typeof tx !== "object" || !Array.isArray(tx.messages) || tx.messages.length === 0) {
      bad("response has no messages");
    }
    if (!Number.isInteger(tx.valid_until) || tx.valid_until <= 0) {
      bad(`invalid valid_until ${tx.valid_until}`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (tx.valid_until > now + MAX_VALID_UNTIL_AHEAD_SECS) {
      bad(`valid_until ${tx.valid_until} is too far in the future`);
    }

    const inAllowed = (to: string): boolean =>
      !!ctx.allowedDest && ctx.allowedDest.some((a) => sameAccount(to, a));

    let attached = 0n;
    for (const m of tx.messages as MessageData[]) {
      if (!m || typeof m.to !== "string" || !m.to) bad("message missing destination");
      // Attached amounts are gas-scale integers; a value past 2**53 means the
      // JSON parse already rounded it — refuse rather than sign a wrong amount.
      if (!Number.isSafeInteger(m.amount) || m.amount < 0) {
        bad(`message amount ${m.amount} is not a safe non-negative integer`);
      }
      if (ctx.allowedDest) {
        // stake = a single transfer to the master, so bind EVERY message.
        // claim = bind only the money-carrying messages (gas to the voucher).
        const mustBind = ctx.kind === "stake" || m.amount > 0;
        if (mustBind && !inAllowed(m.to)) {
          bad(`message to ${m.to} is not an expected destination (${ctx.allowedDest.join(", ")})`);
        }
      }
      attached += BigInt(m.amount);
    }

    const cap = (ctx.offer ?? 0n) + MAX_BUILD_GAS;
    if (attached > cap) {
      bad(`attaches ${attached} nanoTON, above the ${cap} cap`);
    }
    if (ctx.kind === "stake" && ctx.offer !== undefined && attached < ctx.offer) {
      bad(`attaches ${attached} nanoTON, less than the staked ${ctx.offer}`);
    }
    return tx;
  }

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
    // Fail fast (no network) when an authenticated call has no usable session:
    // server-side callers must set `sessionToken`; browser callers use the
    // ambient cookie (`credentials: "include"`).
    if (auth && !this.sessionToken && this.credentials !== "include") {
      throw new TegroFinanceStakingAuthError(
        "no session — pass sessionToken (server) or use credentials:'include' (browser)",
      );
    }
    const url = `${this.apiBase}${API_PREFIX}${STAKING_PREFIX}${path}`;
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller && setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    // Server-side cookie auth: a browser silently ignores a manual Cookie header
    // and sends the real cookie via `credentials: "include"` instead.
    if (auth && this.sessionToken) headers["Cookie"] = `${this.cookieName}=${this.sessionToken}`;

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

/** Normalize a non-negative amount (rejects negatives so a bad feed can't flip a sign). */
function nonNegativeUnits(value: UnitsInput, field: string): bigint {
  const v = toBigIntUnits(value);
  if (v < 0n) throw new RangeError(`${field} must be non-negative, got ${v}`);
  return v;
}

/** Require a strictly positive pool price (a zero/negative price is corrupt data). */
function positivePrice(price: UnitsInput): bigint {
  const p = toBigIntUnits(price);
  if (p <= 0n) throw new RangeError(`pool price must be positive, got ${p}`);
  return p;
}

/**
 * Estimate the TON you'd get for `stgTonUnits` stgTON at the given pool `price`.
 * Floored (truncates toward zero). Non-negative inputs only.
 */
export function stgTonToTon(stgTonUnits: UnitsInput, price: UnitsInput): bigint {
  return (nonNegativeUnits(stgTonUnits, "stgTonUnits") * positivePrice(price)) / RATE_SCALE;
}

/**
 * Estimate the stgTON minted for `tonUnits` TON at the given pool `price`.
 * Floored (truncates toward zero). Non-negative inputs only.
 */
export function tonToStgTon(tonUnits: UnitsInput, price: UnitsInput): bigint {
  return (nonNegativeUnits(tonUnits, "tonUnits") * RATE_SCALE) / positivePrice(price);
}
