import { describe, it, expect, vi } from "vitest";
import {
  TegroFinanceAuthClient,
  TegroFinanceProofError,
  tonProofToLoginRequest,
  type TonProofWallet,
} from "../src/auth.js";
import { TegroFinanceApiError } from "../src/client.js";

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const { status = 200, body } = handler(String(url), init ?? {});
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const wallet = (over: Partial<TonProofWallet> = {}): TonProofWallet => ({
  account: {
    address: "EQuser",
    chain: "-239",
    walletStateInit: "te6stateinit",
    publicKey: "pubkey123",
  },
  connectItems: {
    tonProof: {
      proof: {
        timestamp: 1_700_000_000,
        domain: { lengthBytes: 14, value: "tegro.finance" },
        signature: "sig==",
        payload: "challenge-xyz",
      },
    },
  },
  ...over,
});

describe("TegroFinanceAuthClient", () => {
  it("getPayload GETs /api/v1/auth/get_payload and returns the payload string", async () => {
    const c = new TegroFinanceAuthClient({
      fetch: mockFetch((url) => {
        expect(url).toBe("https://tegro.finance/api/v1/auth/get_payload");
        return { body: { payload: "challenge-xyz" } };
      }),
    });
    expect(await c.getPayload()).toBe("challenge-xyz");
  });

  it("login POSTs the proof to auth_with_ton_proof with credentials and returns the token", async () => {
    let captured = "";
    let credentials: string | undefined;
    const c = new TegroFinanceAuthClient({
      fetch: mockFetch((url, init) => {
        expect(url).toBe("https://tegro.finance/api/v1/auth/auth_with_ton_proof");
        captured = init.body as string;
        credentials = (init as { credentials?: string }).credentials;
        return { body: { token: "sess-123" } };
      }),
    });
    const req = tonProofToLoginRequest(wallet(), { affiliateAddress: "EQref", tgInitData: "init=1" });
    const { token } = await c.login(req);
    expect(token).toBe("sess-123");
    expect(credentials).toBe("include");
    const body = JSON.parse(captured);
    expect(body.address).toBe("EQuser");
    expect(body.network).toBe(-239);
    expect(body.proof.domain.length_bytes).toBe(14);
    expect(body.proof.payload).toBe("challenge-xyz");
    expect(body.affiliate_address).toBe("EQref");
    expect(body.tg_init_data).toBe("init=1");
  });

  it("refreshToken POSTs refresh_token", async () => {
    const c = new TegroFinanceAuthClient({
      fetch: mockFetch((url) => {
        expect(url.endsWith("/auth/refresh_token")).toBe(true);
        return { body: { token: "fresh" } };
      }),
    });
    expect((await c.refreshToken()).token).toBe("fresh");
  });

  it("wraps a non-2xx auth failure as TegroFinanceApiError", async () => {
    const c = new TegroFinanceAuthClient({
      fetch: mockFetch(() => ({ status: 401, body: { detail: "bad proof" } })),
    });
    await expect(c.login(tonProofToLoginRequest(wallet()))).rejects.toBeInstanceOf(TegroFinanceApiError);
  });

  it("rejects a 2xx login body that carries no usable token", async () => {
    const empty = new TegroFinanceAuthClient({ fetch: mockFetch(() => ({ body: {} })) });
    await expect(empty.login(tonProofToLoginRequest(wallet()))).rejects.toBeInstanceOf(TegroFinanceApiError);
    const nulltok = new TegroFinanceAuthClient({ fetch: mockFetch(() => ({ body: { token: null } })) });
    await expect(nulltok.login(tonProofToLoginRequest(wallet()))).rejects.toBeInstanceOf(TegroFinanceApiError);
  });

  it("refreshToken sends the session cookie server-side and validates the result", async () => {
    let cookie: string | undefined;
    const c = new TegroFinanceAuthClient({
      sessionToken: "sess-9",
      fetch: mockFetch((url, init) => {
        expect(url.endsWith("/auth/refresh_token")).toBe(true);
        cookie = (init.headers as Record<string, string>)?.Cookie;
        return { body: { token: "rotated" } };
      }),
    });
    expect((await c.refreshToken()).token).toBe("rotated");
    expect(cookie).toBe("tegro-dex=sess-9");
  });

  it("refuses a sessionToken over http:// or with injection chars, and a bad cookieName", () => {
    expect(() => new TegroFinanceAuthClient({ apiBase: "http://tegro.finance", sessionToken: "s" })).toThrow();
    expect(() => new TegroFinanceAuthClient({ sessionToken: "a;b" })).toThrow();
    expect(() => new TegroFinanceAuthClient({ cookieName: "bad name" })).toThrow();
  });
});

describe("tonProofToLoginRequest", () => {
  it("maps wallet fields to the API's snake_case shape exactly", () => {
    const req = tonProofToLoginRequest(wallet());
    expect(req).toEqual({
      address: "EQuser",
      network: -239,
      proof: {
        timestamp: 1_700_000_000,
        domain: { length_bytes: 14, value: "tegro.finance" },
        signature: "sig==",
        payload: "challenge-xyz",
        state_init: "te6stateinit",
        public_key: "pubkey123",
      },
    });
  });

  it("omits optional fields when absent and never emits affiliate_address/tg_init_data unless set", () => {
    const w = wallet();
    delete w.account.walletStateInit;
    delete w.account.publicKey;
    const req = tonProofToLoginRequest(w);
    expect("state_init" in req.proof).toBe(false);
    expect("public_key" in req.proof).toBe(false);
    expect("affiliate_address" in req).toBe(false);
    expect("tg_init_data" in req).toBe(false);
  });

  it("throws TegroFinanceProofError when the wallet has no proof", () => {
    expect(() => tonProofToLoginRequest(wallet({ connectItems: {} }))).toThrow(TegroFinanceProofError);
  });

  it("throws TegroFinanceProofError when the wallet returned a proof error", () => {
    const w = wallet({ connectItems: { tonProof: { error: "declined" } } });
    expect(() => tonProofToLoginRequest(w)).toThrow(TegroFinanceProofError);
  });
});
