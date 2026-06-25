import { describe, it, expect, vi } from "vitest";
import {
  TegroFinanceStakingClient,
  TegroFinanceStakingAuthError,
  TegroFinanceStakingValidationError,
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

// A second valid mainnet address to stand in for a voucher / wrong destination.
const OTHER = "EQAvDfWFG0oYX19jwNDNBBL1rKNT9XfaGP9HyTb5nb2Eml6y";
const soon = () => Math.floor(Date.now() / 1000) + 120;

describe("TegroFinanceStakingClient build (auth)", () => {
  it("buildStake POSTs nanoTON offer_amount as an unquoted integer, with cookie + credentials", async () => {
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
        // attaches the staked TON + 0.1 gas, to the master — passes validation.
        return { body: { valid_until: soon(), messages: [{ to: MASTER, amount: 5_100_000_000, payload: "te6cc..." }] } };
      }),
    });
    const tx = await c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n });
    expect(tx.messages[0].to).toBe(MASTER);
    expect(captured).toContain('"offer_amount":5000000000');
    expect(captured).not.toContain('"5000000000"');
    expect(cookie).toBe("tegro-dex=sess-abc");
    expect(credentials).toBe("include");
  });

  it("buildUnstake POSTs shares_amount; response carries gas only", async () => {
    let captured = "";
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch((url, init) => {
        expect(url.endsWith(`/pool/${MASTER}/unstake`)).toBe(true);
        captured = init.body as string;
        return { body: { valid_until: soon(), messages: [{ to: OTHER, amount: 150_000_000, payload: "burn" }] } };
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
        return { body: { valid_until: soon(), messages: [{ to: OTHER, amount: 100_000_000, payload: "claim" }] } };
      }),
    });
    await c.buildClaim({ masterAddress: MASTER, voucherAddress: OTHER });
    expect(JSON.parse(captured)).toEqual({ voucher_address: OTHER });
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
    expect(cookie).toBe("tegro-dex=fresh");
  });
});

describe("build validation (trust boundary)", () => {
  const stakeClient = (body: unknown) =>
    new TegroFinanceStakingClient({ sessionToken: "s", fetch: mockFetch(() => ({ body })) });

  it("rejects a stake whose TON is redirected away from the master", async () => {
    const c = stakeClient({ valid_until: soon(), messages: [{ to: OTHER, amount: 5_100_000_000, payload: "x" }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects a stake that attaches far more than offered (drain)", async () => {
    const c = stakeClient({ valid_until: soon(), messages: [{ to: MASTER, amount: 9_000_000_000, payload: "x" }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }), // cap = 5 + 2 = 7 TON
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects a stake that attaches less than offered", async () => {
    const c = stakeClient({ valid_until: soon(), messages: [{ to: MASTER, amount: 1_000_000_000, payload: "x" }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects an attached amount past 2**53 (precision-corrupted)", async () => {
    const c = stakeClient({ valid_until: soon(), messages: [{ to: MASTER, amount: 9_007_199_254_740_993, payload: "x" }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects an empty / shapeless response", async () => {
    const c = stakeClient({ valid_until: soon(), messages: [] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects a far-future valid_until (replay window)", async () => {
    const c = stakeClient({ valid_until: soon() + 100_000, messages: [{ to: MASTER, amount: 5_100_000_000 }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects an unstake that attaches more than gas", async () => {
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch(() => ({ body: { valid_until: soon(), messages: [{ to: OTHER, amount: 3_000_000_000 }] } })),
    });
    await expect(
      c.buildUnstake({ masterAddress: MASTER, sharesAmount: 1_000_000_000n }), // cap = 2 TON gas
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects a stake with a zero-value side message to a foreign address", async () => {
    const c = stakeClient({
      valid_until: soon(),
      messages: [
        { to: MASTER, amount: 5_100_000_000, payload: "x" },
        { to: OTHER, amount: 0, payload: "drain" }, // every stake message must be the master
      ],
    });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("accepts a stake whose destination is the master in UQ (non-bounceable) form", async () => {
    const masterUQ = "UQC-DUl20SfQFVH34cky8N76la1K0Uu5UWjel5IEn7mjIuoZ";
    const c = stakeClient({ valid_until: soon(), messages: [{ to: masterUQ, amount: 5_100_000_000, payload: "x" }] });
    const tx = await c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n });
    expect(tx.messages[0].to).toBe(masterUQ);
  });

  it("rejects a claim whose gas is sent to neither the voucher nor the master", async () => {
    const VOUCHER = "EQAIBTuglI7b6vWEG5ukfHnwgWzf-ZHmjsbEtS4mJNh5geZW";
    const c = new TegroFinanceStakingClient({
      sessionToken: "s",
      fetch: mockFetch(() => ({ body: { valid_until: soon(), messages: [{ to: OTHER, amount: 100_000_000 }] } })),
    });
    await expect(
      c.buildClaim({ masterAddress: MASTER, voucherAddress: VOUCHER }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });

  it("rejects a fractional valid_until", async () => {
    const c = stakeClient({ valid_until: soon() + 0.5, messages: [{ to: MASTER, amount: 5_100_000_000 }] });
    await expect(
      c.buildStake({ masterAddress: MASTER, offerAmount: 5_000_000_000n }),
    ).rejects.toBeInstanceOf(TegroFinanceStakingValidationError);
  });
});

describe("input guards", () => {
  const c = () =>
    new TegroFinanceStakingClient({ sessionToken: "s", fetch: mockFetch(() => ({ body: {} })) });

  it("buildStake rejects zero / negative offer before any request", async () => {
    await expect(c().buildStake({ masterAddress: MASTER, offerAmount: 0n })).rejects.toThrow();
    await expect(c().buildStake({ masterAddress: MASTER, offerAmount: -1n })).rejects.toThrow();
  });

  it("buildUnstake rejects zero / negative shares", async () => {
    await expect(c().buildUnstake({ masterAddress: MASTER, sharesAmount: 0n })).rejects.toThrow();
    await expect(c().buildUnstake({ masterAddress: MASTER, sharesAmount: -5n })).rejects.toThrow();
  });

  it("buildClaim rejects a malformed voucher address", async () => {
    await expect(c().buildClaim({ masterAddress: MASTER, voucherAddress: "not-an-address" })).rejects.toThrow();
  });

  it("constructor refuses to carry a sessionToken over a non-https base (any case)", () => {
    expect(() => new TegroFinanceStakingClient({ apiBase: "http://tegro.finance", sessionToken: "s" })).toThrow();
    expect(() => new TegroFinanceStakingClient({ apiBase: "HTTP://tegro.finance", sessionToken: "s" })).toThrow();
    expect(() => new TegroFinanceStakingClient({ apiBase: "tegro.finance", sessionToken: "s" })).toThrow();
    // https in any case is fine.
    expect(() => new TegroFinanceStakingClient({ apiBase: "HTTPS://tegro.finance", sessionToken: "s" })).not.toThrow();
  });

  it("refuses a sessionToken with header-injection characters", () => {
    expect(() => new TegroFinanceStakingClient({ sessionToken: "ab;cd" })).toThrow();
    expect(() => new TegroFinanceStakingClient({ sessionToken: "ab\r\nSet-Cookie: x" })).toThrow();
    const ok = new TegroFinanceStakingClient({ sessionToken: "good" });
    expect(() => ok.setSessionToken("bad\nvalue")).toThrow();
  });

  it("authenticated call with no session and non-include credentials fails without a request", async () => {
    let called = false;
    const c2 = new TegroFinanceStakingClient({
      credentials: "same-origin",
      fetch: mockFetch(() => {
        called = true;
        return { body: [] };
      }),
    });
    await expect(c2.getWithdrawals(MASTER)).rejects.toBeInstanceOf(TegroFinanceStakingAuthError);
    expect(called).toBe(false);
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
    expect(stgTonToTon(10_000_000_000n, PRICE)).toBe(10_010_052_230n);
  });

  it("tonToStgTon inverts the rate (floored, exact)", () => {
    expect(tonToStgTon(10_000_000_000n, PRICE)).toBe(9_989_957_864n);
  });

  it("both reject a non-positive price", () => {
    expect(() => tonToStgTon(1n, 0n)).toThrow();
    expect(() => stgTonToTon(1n, 0n)).toThrow();
    expect(() => stgTonToTon(1n, -5n)).toThrow();
  });

  it("both reject negative amounts", () => {
    expect(() => stgTonToTon(-1n, PRICE)).toThrow();
    expect(() => tonToStgTon(-1n, PRICE)).toThrow();
  });

  it("rate at parity (price = 1e9) is identity", () => {
    expect(stgTonToTon(123n, 1_000_000_000n)).toBe(123n);
    expect(tonToStgTon(123n, 1_000_000_000n)).toBe(123n);
  });
});
