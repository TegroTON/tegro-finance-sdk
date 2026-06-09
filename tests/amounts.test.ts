import { describe, it, expect } from "vitest";
import { toUnits, fromUnits, toBigIntUnits, applySlippage } from "../src/amounts.js";

describe("toUnits", () => {
  it("converts whole and fractional amounts exactly", () => {
    expect(toUnits("1", 9)).toBe(1_000_000_000n);
    expect(toUnits("1.5", 9)).toBe(1_500_000_000n);
    expect(toUnits("0.000000001", 9)).toBe(1n);
    expect(toUnits("0", 9)).toBe(0n);
    expect(toUnits("123.456789", 6)).toBe(123_456_789n);
  });

  it("handles decimals=0 and large values without float error", () => {
    expect(toUnits("0", 0)).toBe(0n);
    expect(toUnits("1000000000", 0)).toBe(1_000_000_000n);
    // 9-decimal amount that overflows a JS safe integer stays exact.
    expect(toUnits("10000000.123456789", 9)).toBe(10_000_000_123_456_789n);
  });

  it("accepts a numeric amount and expands exponential notation", () => {
    expect(toUnits(1.5, 9)).toBe(1_500_000_000n);
    expect(toUnits(1e-7, 9)).toBe(100n);
  });

  it("rejects more fractional digits than decimals (never truncates money)", () => {
    expect(() => toUnits("1.0000000001", 9)).toThrow();
    expect(() => toUnits("1.5", 0)).toThrow();
  });

  it("rejects garbage input", () => {
    expect(() => toUnits("abc", 9)).toThrow();
    expect(() => toUnits("", 9)).toThrow();
    expect(() => toUnits("1.2.3", 9)).toThrow();
  });
});

describe("fromUnits", () => {
  it("round-trips with toUnits", () => {
    for (const [amt, dec] of [["1.5", 9], ["0.000000001", 9], ["123.456", 6]] as const) {
      expect(fromUnits(toUnits(amt, dec), dec)).toBe(amt);
    }
  });

  it("trims trailing zeros and handles whole numbers", () => {
    expect(fromUnits(1_500_000_000n, 9)).toBe("1.5");
    expect(fromUnits(1_000_000_000n, 9)).toBe("1");
    expect(fromUnits(1n, 9)).toBe("0.000000001");
    expect(fromUnits(0n, 9)).toBe("0");
  });

  it("accepts string and number unit inputs", () => {
    expect(fromUnits("1500000000", 9)).toBe("1.5");
    expect(fromUnits(1500000000, 9)).toBe("1.5");
  });
});

describe("toBigIntUnits", () => {
  it("normalizes bigint | number | string", () => {
    expect(toBigIntUnits(5n)).toBe(5n);
    expect(toBigIntUnits(5)).toBe(5n);
    expect(toBigIntUnits("5")).toBe(5n);
  });

  it("rejects unsafe number integers (forces bigint/string)", () => {
    expect(() => toBigIntUnits(Number.MAX_SAFE_INTEGER + 2)).toThrow();
    expect(() => toBigIntUnits(1.5)).toThrow();
  });
});

describe("applySlippage", () => {
  it("floors the expected output by the tolerance", () => {
    expect(applySlippage(1000n, 0.01)).toBe(990n);
    expect(applySlippage(1_000_000_000n, 0.005)).toBe(995_000_000n);
    expect(applySlippage(1000n, 0)).toBe(1000n);
  });

  it("rounds the floor toward zero (never lets a worse trade through)", () => {
    // 999 * 0.99 = 989.01 → floor 989, not 990
    expect(applySlippage(999n, 0.01)).toBe(989n);
  });

  it("rejects out-of-range tolerance", () => {
    expect(() => applySlippage(1000n, 1)).toThrow();
    expect(() => applySlippage(1000n, -0.1)).toThrow();
  });
});
