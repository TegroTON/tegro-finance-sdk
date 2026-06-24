import { describe, it, expect, vi } from "vitest";
import {
  TegroFinanceStakingClient,
  TegroFinanceStakingAuthError,
  stgTonToTon,
  tonToStgTon,
} from "../src/staking.js";
import { TegroFinanceApiError } from "../src/client.js";

const MASTER = "EQC-DUl20SfQFVH34cky8N76la1K0Uu5UWjel5IEn7mjIrfc";

function mockFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown },
) {
  return vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const { status = 200, body } = handler(String(url), init ?? {});
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("TegroFinanceStakingClient read", () => {
  it("GETs /liquid-staking/pools against the staking default base (tegro.finance, not api.)", async () => {
    const c = new TegroFinanceStakingClient({
      fetch: mockFetch((url) => {
        expect(url).toBe("https://tegro.finance/api/v1/liquid-staking/pools");
        return {
          body: [
            {
              address: MASTER,
              in_asset: { contract_address: "EQ...TON", symbol: "TON", decimals: 9 },
              out_asset: { contract_address: MASTER, symbol: "stgTON", decimals: 9 },
              apy: 16.97, // percent, not a fraction
              fees: 100000000,
              min_offer_amount: 1200000000,
              is_active: true,
            },
          ],
        };
      }),
    });
    const pools = await c.getPools();
    expect(pools[0].address).toBe(MASTER);
    expect(pools[0].out_asset.symbol).toBe("stgTON");
    expect(pools[0].apy).toBe(16.97);
  });

  it("GETs pool data and exposes the live rate", async () => {
    const c = new TegroFinanceStakingClient({
      fetch: mockFetch((url) => {
        expect(url).toBe(`https://tegro.finance/api/v1/liquid-staking/pool/${MASTER}/data`);
        return { body: { address: MASTER, price: 1001005223, is_active: true } };
      }),
    });
    const data = await c.getPoolData(MASTER);
    expect(data.price).toBe(1001005223);
  });
});

describe("TegroFinanceStakingClient build (auth)", () => {
  it("buildStake POSTs nanoTON offer_amount, bigint-safe, with cookie + credentials", async () => {
    let captured = "";
    let cookie: string | undefined;
    let credentials: string | undefined;
    const c = new TegroFinanceStakingClient({
      sessionToken: "sess-abc",
      fetch: mockFetch((url, init) => {
        expect(url).toBe(`https://tegro.finance/api/v1/liquid-staking/pool/${MASTER}/stake`);
        captured = init.body as string;
        cookie = (init.headers as Record<string, string>)?.Cookie;
        credentials = (init as { credentials?: string }).credentials;
        return { body: { valid_until: 1700000060, messages: [{ to: MASTER, amount: 5000000000, payload: "te6cc..." }] } };
      }),
    });
    const tx = await c.buildStake({ masterAddress: MASTER, offerAmount: 50_000_000_123_456_789n });
    expect(tx.messages[0].to).toBe(MASTER);
    // bigint serialized as an UNQUOTED integer, full precision.
    expect(captured).toContain('"offer_amount":50000000123456789');
    expect(captured).not.toContain('"50000000123456789"');
    expect(cookie).toBe("token=sess-abc");
    expect(credentials).toBe("include");
  });

  it("buildUnstake POSTs shares_amount", async () => {
    let captured = "";
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch((url, init) => {
        expect(url.endsWith(`/pool/${MASTER}/unstake`)).toBe(true);
        captured = init.body as string;
        return { body: { valid_until: 1, messages: [] } };
      }),
    });
    await c.buildUnstake({ masterAddress: MASTER, sharesAmount: 1_500_000_000n });
    expect(JSON.parse(captured)).toEqual({ shares_amount: 1500000000 });
  });

  it("buildClaim POSTs the voucher address", async () => {
    let captured = "";
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch((url, init) => {
        expect(url.endsWith(`/pool/${MASTER}/claim`)).toBe(true);
        captured = init.body as string;
        return { body: { valid_until: 1, messages: [] } };
      }),
    });
    await c.buildClaim({ masterAddress: MASTER, voucherAddress: "EQvoucher" });
    expect(JSON.parse(captured)).toEqual({ voucher_address: "EQvoucher" });
  });

  it("setSessionToken updates the cookie used on later calls", async () => {
    let cookie: string | undefined;
    const c = new TegroFinanceStakingClient({
      fetch: mockFetch((_url, init) => {
        cookie = (init.headers as Record<string, string>)?.Cookie;
        return { body: [] };
      }),
    });
    c.setSessionToken("fresh");
    await c.getWithdrawals(MASTER);
    expect(cookie).toBe("token=fresh");
  });
});

describe("TegroFinanceStakingClient auth errors", () => {
  it("maps 401 on an auth endpoint to TegroFinanceStakingAuthError", async () => {
    const c = new TegroFinanceStakingClient({
      sessionToken: "expired",
      fetch: mockFetch(() => ({ status: 401, body: { detail: "unauthorized" } })),
    });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 1_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingAuthError);
  });

  it("still wraps non-auth failures as TegroFinanceApiError", async () => {
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch(() => ({ status: 404, body: { detail: "Pool not found" } })),
    });
    await expect(c.getPoolData("EQnope")).rejects.toBeInstanceOf(TegroFinanceApiError);
  });
});

describe("rate helpers", () => {
  const PRICE = 1_001_005_223n; // 1.001005223 TON per stgTON

  it("stgTonToTon applies the appreciating rate (floored, exact)", () => {
    // 10 stgTON -> 10 * 1.001005223 = 10.01005223 TON
    expect(stgTonToTon(10_000_000_000n, PRICE)).toBe(10_010_052_230n);
  });

  it("tonToStgTon inverts the rate (floored, exact)", () => {
    // 10 TON -> 10 / 1.001005223 ≈ 9.98995... stgTON (10e18 / price, floored)
    expect(tonToStgTon(10_000_000_000n, PRICE)).toBe(9_989_957_864n);
  });

  it("rejects a non-positive price", () => {
    expect(() => tonToStgTon(1n, 0n)).toThrow();
  });

  it("rate at parity (price = 1e9) is identity", () => {
    expect(stgTonToTon(123n, 1_000_000_000n)).toBe(123n);
    expect(tonToStgTon(123n, 1_000_000_000n)).toBe(123n);
  });
});
