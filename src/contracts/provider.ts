// Jetton-wallet address resolution for the on-chain path.
//
// Building a swap/liquidity transaction client-side (without our backend) needs
// the jetton wallet addresses for (owner, minter) pairs — the router's wallet
// for a token, the user's wallet for a token, the router's pTON wallet, etc.
// Those come from the standard TEP-89 `get_wallet_address` get-method on the
// jetton minter.
//
// The SDK depends only on @ton/core for cells; it does NOT bundle a TON RPC
// client. Instead it defines a small resolver interface and ships one built-in
// implementation over TON API (tonapi.io) via `fetch`. Power users can plug
// their own (e.g. a @ton/ton TonClient, a self-hosted node, a cache).

import { Address } from "@ton/core";

/** Resolves the jetton wallet address for an (owner, minter) pair. */
export interface JettonWalletResolver {
  /**
   * @param jettonMinter the jetton master contract address
   * @param owner        the wallet that owns (or will own) the jetton wallet
   * @returns the jetton wallet address as a bounceable `EQ…` string
   */
  getWalletAddress(jettonMinter: string, owner: string): Promise<string>;
}

export interface TonApiResolverOptions {
  /** API base. Default `https://tonapi.io`. Use `https://testnet.tonapi.io` for testnet. */
  baseUrl?: string;
  /** Optional tonapi API key (raises rate limits). Sent as `Authorization: Bearer`. */
  apiKey?: string;
  /** Inject a custom fetch (tests / proxies). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

/**
 * A {@link JettonWalletResolver} backed by TON API (tonapi.io). This is the same
 * service the production backend uses for `get_wallet_address`.
 */
export function tonApiResolver(opts: TonApiResolverOptions = {}): JettonWalletResolver {
  const baseUrl = (opts.baseUrl ?? "https://tonapi.io").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    async getWalletAddress(jettonMinter: string, owner: string): Promise<string> {
      const url =
        `${baseUrl}/v2/blockchain/accounts/${encodeURIComponent(jettonMinter)}` +
        `/methods/get_wallet_address?args=${encodeURIComponent(owner)}`;

      const controller = timeoutMs > 0 ? new AbortController() : undefined;
      const timer = controller && setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await f(url, {
          headers: opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : undefined,
          signal: controller?.signal,
        });
      } catch (err) {
        throw new JettonWalletResolutionError(
          controller?.signal.aborted ? "request timed out" : String((err as Error)?.message ?? err),
        );
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (!res.ok) {
        throw new JettonWalletResolutionError(`get_wallet_address HTTP ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        exit_code?: number;
        decoded?: { jetton_wallet_address?: string };
        stack?: Array<{ type?: string; cell?: string }>;
      };

      if (body.success === false || (body.exit_code !== undefined && body.exit_code !== 0)) {
        throw new JettonWalletResolutionError(
          `get_wallet_address failed (exit_code ${body.exit_code}) for minter ${jettonMinter}`,
        );
      }

      const raw = body.decoded?.jetton_wallet_address;
      if (raw) return Address.parse(raw).toString(); // normalize to bounceable EQ…

      // Fallback: parse the address out of the returned cell.
      const cellHex = body.stack?.[0]?.cell;
      if (cellHex) {
        try {
          const { Cell } = await import("@ton/core");
          const slice = Cell.fromBoc(Buffer.from(cellHex, "hex"))[0].beginParse();
          return slice.loadAddress().toString();
        } catch {
          /* fall through to error below */
        }
      }
      throw new JettonWalletResolutionError(
        `could not resolve jetton wallet for minter ${jettonMinter}, owner ${owner}`,
      );
    },
  };
}

/** A simple in-memory memoizing wrapper — (owner, minter) pairs are immutable. */
export function cachingResolver(inner: JettonWalletResolver): JettonWalletResolver {
  const cache = new Map<string, Promise<string>>();
  return {
    getWalletAddress(jettonMinter: string, owner: string): Promise<string> {
      const key = `${jettonMinter}|${owner}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = inner.getWalletAddress(jettonMinter, owner).catch((e) => {
          cache.delete(key); // don't cache failures
          throw e;
        });
        cache.set(key, hit);
      }
      return hit;
    },
  };
}

export class JettonWalletResolutionError extends Error {
  constructor(message: string) {
    super(`tegro_finance_resolve_error:${message}`);
    this.name = "JettonWalletResolutionError";
  }
}
