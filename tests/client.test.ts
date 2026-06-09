import { describe, it, expect, vi } from "vitest";
import {
  TegroFinanceClient,
  TegroFinanceApiError,
  TegroFinanceDexError,
  stringifyWithBigInt,
} from "../src/client.js";

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const { status = 200, body } = handler(String(url), init ?? {});
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("TegroFinanceClient read", () => {
  it("GETs /api/v1/pools against the default base", async () => {
    const c = new TegroFinanceClient({
      fetch: mockFetch((url) => {
        expect(url).toBe("https://api.tegro.finance/api/v1/pools");
        return { body: [{ address: "EQpool", router_address: "EQrouter" }] };
      }),
    });
    const pools = await c.getPools();
    expect(pools[0].address).toBe("EQpool");
  });

  it("honors a custom apiBase and trims trailing slash", async () => {
    const c = new TegroFinanceClient({
      apiBase: "https://tegro.finance/",
      fetch: mockFetch((url) => {
        expect(url).toBe("https://tegro.finance/api/v1/assets");
        return { body: {} };
      }),
    });
    await c.getAssets();
  });

  it("getAssetList flattens the asset map", async () => {
    const c = new TegroFinanceClient({
      fetch: mockFetch(() => ({
        body: {
          EQa: { contract_address: "EQa", symbol: "TON", decimals: 9 },
          EQb: { contract_address: "EQb", symbol: "TGR", decimals: 9 },
        },
      })),
    });
    const list = await c.getAssetList();
    expect(list.map((a) => a.symbol).sort()).toEqual(["TGR", "TON"]);
  });

  it("builds a logo URL without fetching", () => {
    const c = new TegroFinanceClient();
    expect(c.tokenLogoUrl("EQabc")).toBe("https://api.tegro.finance/api/v1/tokens/logo/EQabc");
  });
});

describe("TegroFinanceClient.simulateSwap", () => {
  it("POSTs snake_case body and returns the quote", async () => {
    let captured = "";
    const c = new TegroFinanceClient({
      fetch: mockFetch((url, init) => {
        expect(url.endsWith("/swap/simulate")).toBe(true);
        captured = init.body as string;
        return {
          body: {
            offer_address: "EQoffer",
            offer_units: 1000000000,
            ask_address: "EQask",
            ask_units: 1700000,
            min_ask_units: 1683000,
            pool_address: "EQpool",
            router_address: "EQrouter",
            fee_address: "EQfee",
            fee_percent: 0.2,
            fee_units: 2000000,
            price_impact: 0.001,
            swap_rate: 0.0017,
            slippage_tolerance: 0.01,
            fee_min: 200000000,
            fee_max: 300000000,
          },
        };
      }),
    });
    const q = await c.simulateSwap({
      offerAddress: "EQoffer",
      askAddress: "EQask",
      units: 1_000_000_000n,
      slippageTolerance: 0.01,
    });
    expect(q.ask_units).toBe(1700000);
    const body = JSON.parse(captured);
    expect(body.offer_address).toBe("EQoffer");
    expect(body.units).toBe(1000000000);
    expect(body.slippage_tolerance).toBe(0.01);
  });

  it("throws TegroFinanceDexError on a {type:error} envelope (HTTP 200)", async () => {
    const c = new TegroFinanceClient({
      fetch: mockFetch(() => ({
        status: 200,
        body: { type: "error", code: 21, message: "Pool not found" },
      })),
    });
    await expect(
      c.simulateSwap({ offerAddress: "EQa", askAddress: "EQb", units: 1n, slippageTolerance: 0.01 }),
    ).rejects.toBeInstanceOf(TegroFinanceDexError);
  });
});

describe("TegroFinanceClient.buildSwap", () => {
  it("sends camelCase body and serializes bigint units as JSON integers", async () => {
    let captured = "";
    const c = new TegroFinanceClient({
      fetch: mockFetch((url, init) => {
        expect(url.endsWith("/swap")).toBe(true);
        captured = init.body as string;
        return { body: { valid_until: 1700000060, messages: [{ to: "EQrouter", amount: 300000000, payload: "te6cc..." }] } };
      }),
    });
    const tx = await c.buildSwap({
      userWalletAddress: "EQuser",
      offerJettonAddress: "EQoffer",
      offerAmount: 10_000_000_123_456_789n, // > 2**53
      askJettonAddress: "EQask",
      minAskAmount: 1_683_000n,
    });
    expect(tx.messages[0].to).toBe("EQrouter");
    // The big integer must appear UNQUOTED and with full precision in the body.
    expect(captured).toContain('"offerAmount":10000000123456789');
    expect(captured).not.toContain('"10000000123456789"');
  });
});

describe("error handling", () => {
  it("wraps non-2xx into TegroFinanceApiError with the FastAPI detail", async () => {
    const c = new TegroFinanceClient({
      fetch: mockFetch(() => ({ status: 404, body: { detail: "Not Found" } })),
    });
    await expect(c.getPoolsForToken("EQnope")).rejects.toBeInstanceOf(TegroFinanceApiError);
  });
});

describe("stringifyWithBigInt", () => {
  it("emits unquoted integers for bigint and leaves other types intact", () => {
    const out = stringifyWithBigInt({ a: 5n, b: "x", c: 1.5, d: true, e: -42n });
    expect(out).toBe('{"a":5,"b":"x","c":1.5,"d":true,"e":-42}');
  });
});
