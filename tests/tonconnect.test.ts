import { describe, it, expect } from "vitest";
import { toTonConnectMessages } from "../src/tonconnect.js";
import type { TransactionData } from "../src/types.js";

const tx: TransactionData = {
  valid_until: 1_700_000_060,
  messages: [
    { to: "EQrouter", amount: 300_000_000, payload: "te6ccgEBAQEA..." },
    { to: "EQjettonwallet", amount: 50_000_000, payload: null },
  ],
};

describe("toTonConnectMessages", () => {
  it("maps to → address, amount → string, and passes payload through", () => {
    const req = toTonConnectMessages(tx);
    expect(req.validUntil).toBe(1_700_000_060);
    expect(req.messages[0]).toEqual({
      address: "EQrouter",
      amount: "300000000",
      payload: "te6ccgEBAQEA...",
    });
  });

  it("omits payload when the backend sent none", () => {
    const req = toTonConnectMessages(tx);
    expect(req.messages[1]).toEqual({ address: "EQjettonwallet", amount: "50000000" });
    expect("payload" in req.messages[1]).toBe(false);
  });

  it("recomputes validUntil when an override is given", () => {
    const before = Math.floor(Date.now() / 1000);
    const req = toTonConnectMessages(tx, 120);
    expect(req.validUntil).toBeGreaterThanOrEqual(before + 120);
    expect(req.validUntil).toBeLessThanOrEqual(before + 121);
  });
});
