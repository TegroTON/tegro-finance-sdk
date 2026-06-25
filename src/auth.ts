// TON Connect authentication for Tegro Finance.
//
// The staking builder endpoints (stake/unstake/claim) require a wallet session.
// The session is established with TON Connect "ton_proof": the wallet signs a
// server-issued payload, the server verifies the signature and issues a session
// (a `tegro-dex` cookie, also returned in the body). Three endpoints, under
// `/api/v1/auth/`:
//   • GET  get_payload         → { payload }        (challenge to sign)
//   • POST auth_with_ton_proof → { token }          (verify proof, open session)
//   • POST refresh_token       → { token }          (extend an existing session)
//
// This client is framework-agnostic and has no TON Connect dependency: you pass
// the payload to your wallet UI, and feed the wallet's signed proof back in via
// {@link tonProofToLoginRequest}. The wallet signs; the SDK holds no keys.
// Endpoints/shapes verified 2026-06-25 against the production frontend.

import { TegroFinanceApiError } from "./client.js";
import { assertCookieName, assertUsableToken, type CredentialsMode } from "./staking.js";

const DEFAULT_API_BASE = "https://tegro.finance";
const API_PREFIX = "/api/v1";
const AUTH_PREFIX = "/auth";
/** Session cookie name the production backend reads (jwt.py `TOKEN_KEY`). */
const DEFAULT_COOKIE_NAME = "tegro-dex";

/** Linear trailing-slash trim (no regex — avoids quadratic backtracking). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

// ---- types --------------------------------------------------------------

/** The signed proof returned by a TON Connect wallet, in the API's field names. */
export interface AuthProof {
  timestamp: number;
  domain: { length_bytes: number; value: string };
  signature: string;
  payload: string;
  state_init?: string;
  public_key?: string;
}

/** Body of `POST /api/v1/auth/auth_with_ton_proof` (verified against the backend). */
export interface AuthLoginRequest {
  address: string;
  /** Workchain/network id as a number (TON mainnet = `-239`, testnet = `-3`). */
  network: number;
  proof: AuthProof;
  /** Optional referrer wallet to attribute a newly-created account to. */
  affiliate_address?: string;
  /** Optional Telegram Mini App `initData` to bind the Telegram account. */
  tg_init_data?: string;
}

/** Session token issued by the auth endpoints (also set as the `tegro-dex` cookie). */
export interface TokenResponse {
  token: string;
  /** Present when a Telegram bind payload is returned. */
  telegram_payload?: string;
}

/**
 * The subset of a TON Connect wallet (`@tonconnect/ui` `Wallet`) that
 * {@link tonProofToLoginRequest} reads. Typed structurally so the SDK keeps
 * zero runtime deps — any object of this shape works.
 */
export interface TonProofWallet {
  account: {
    address: string;
    chain: string | number;
    walletStateInit?: string;
    publicKey?: string;
  };
  connectItems?: {
    tonProof?:
      | {
          proof: {
            timestamp: number;
            domain: { lengthBytes: number; value: string };
            signature: string;
            payload: string;
          };
        }
      | { error: unknown };
  };
}

export interface TegroFinanceAuthClientOptions {
  /** API origin. Default `https://tegro.finance` (the session cookie's scope). */
  apiBase?: string;
  /** Fetch credentials mode. Default `"include"` so the `tegro-dex` cookie is set/sent. */
  credentials?: CredentialsMode;
  /**
   * Existing session token, for server-side `refreshToken()` (no browser cookie
   * jar). Sent as the `tegro-dex` cookie; requires an https `apiBase`. Set later
   * with {@link TegroFinanceAuthClient.setSessionToken}.
   */
  sessionToken?: string;
  /** Session cookie name the backend reads. Default `"tegro-dex"`. */
  cookieName?: string;
  /** Inject a custom fetch (tests, proxies, retry wrappers). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. Set 0 to disable. */
  timeoutMs?: number;
}

/** Thrown when a wallet object carries no usable ton_proof to log in with. */
export class TegroFinanceProofError extends Error {
  constructor(message: string) {
    super(`tegro_finance_proof_error:${message}`);
    this.name = "TegroFinanceProofError";
  }
}

// ---- proof mapping ------------------------------------------------------

/**
 * Map a connected TON Connect wallet's signed `ton_proof` into the
 * {@link AuthLoginRequest} the login endpoint expects.
 *
 * Request the proof BEFORE the wallet connects by passing the
 * {@link TegroFinanceAuthClient.getPayload} result to your wallet UI
 * (e.g. `tonConnectUI.setConnectRequestParameters({ state: "ready",
 * value: { tonProof: payload } })`). After connect, hand the wallet here.
 *
 * @throws {TegroFinanceProofError} if the wallet returned no proof (or an error).
 */
export function tonProofToLoginRequest(
  wallet: TonProofWallet,
  opts: { affiliateAddress?: string; tgInitData?: string } = {},
): AuthLoginRequest {
  const item = wallet?.connectItems?.tonProof;
  if (!item || "error" in item) {
    throw new TegroFinanceProofError(
      "wallet returned no ton_proof — set the payload via setConnectRequestParameters before connecting",
    );
  }
  const p = item.proof;
  const network = Number(wallet.account.chain);
  if (!Number.isInteger(network)) {
    throw new TegroFinanceProofError(`wallet.account.chain is not a network id: ${wallet.account.chain}`);
  }
  return {
    address: wallet.account.address,
    network,
    proof: {
      timestamp: p.timestamp,
      domain: { length_bytes: p.domain.lengthBytes, value: p.domain.value },
      signature: p.signature,
      payload: p.payload,
      ...(wallet.account.walletStateInit ? { state_init: wallet.account.walletStateInit } : {}),
      ...(wallet.account.publicKey ? { public_key: wallet.account.publicKey } : {}),
    },
    ...(opts.affiliateAddress ? { affiliate_address: opts.affiliateAddress } : {}),
    ...(opts.tgInitData ? { tg_init_data: opts.tgInitData } : {}),
  };
}

// ---- client -------------------------------------------------------------

export class TegroFinanceAuthClient {
  private readonly apiBase: string;
  private readonly credentials: CredentialsMode;
  private readonly cookieName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionToken: string | undefined;

  constructor(opts: TegroFinanceAuthClientOptions = {}) {
    this.apiBase = stripTrailingSlashes(opts.apiBase ?? DEFAULT_API_BASE);
    this.credentials = opts.credentials ?? "include";
    this.cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
    assertCookieName(this.cookieName);
    this.sessionToken = opts.sessionToken;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetch ?? fetch;
    if (this.sessionToken) assertUsableToken(this.sessionToken, this.apiBase);
  }

  /** Set (or clear) the server-side session token used by {@link refreshToken}. */
  setSessionToken(token: string | null): void {
    if (token) assertUsableToken(token, this.apiBase);
    this.sessionToken = token ?? undefined;
  }

  /**
   * Get a fresh payload to be signed by the wallet. Feed it to your TON Connect
   * UI before the user connects. Payloads are short-lived — fetch one per
   * connect attempt (the production app refreshes well within ~20 min).
   */
  async getPayload(): Promise<string> {
    const r = await this.request<{ payload: string }>("GET", "/get_payload");
    if (!r || typeof r.payload !== "string" || !r.payload) {
      throw new TegroFinanceApiError("auth get_payload returned no payload", 0, r);
    }
    return r.payload;
  }

  /**
   * Verify a wallet's signed proof and open a session. Returns the session
   * `token`; in a browser the `tegro-dex` cookie is set too (credentials:"include").
   * Hand the token to `TegroFinanceStakingClient.setSessionToken(token)` for
   * server-side use.
   */
  async login(req: AuthLoginRequest): Promise<TokenResponse> {
    const r = this.assertToken(await this.request<TokenResponse>("POST", "/auth_with_ton_proof", req));
    // Remember the session so a later server-side refreshToken() just works.
    // Only over https (the cookie is a credential); browsers use the real cookie.
    if (this.apiBase.toLowerCase().startsWith("https://")) this.sessionToken = r.token;
    return r;
  }

  /**
   * Extend the current session, returning a refreshed token. In a browser the
   * session cookie is sent automatically; server-side set `sessionToken` first.
   */
  async refreshToken(): Promise<TokenResponse> {
    return this.assertToken(await this.request<TokenResponse>("POST", "/refresh_token", undefined, true));
  }

  /** Reject a 2xx body that does not actually carry a usable session token. */
  private assertToken(r: TokenResponse): TokenResponse {
    if (!r || typeof r.token !== "string" || !r.token.trim()) {
      throw new TegroFinanceApiError("auth response carried no session token", 0, r);
    }
    return r;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    auth = false,
  ): Promise<T> {
    const url = `${this.apiBase}${API_PREFIX}${AUTH_PREFIX}${path}`;
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller && setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.sessionToken) headers["Cookie"] = `${this.cookieName}=${this.sessionToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: this.credentials,
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
