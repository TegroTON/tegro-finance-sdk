// Amount helpers. Token "units" are integers in the smallest denomination
// (like nanotons for TON, or 10**decimals for a jetton). All conversion is
// done with BigInt + string parsing — never floating point — so 9-decimal
// TON amounts and large jetton supplies keep full precision.

import type { UnitsInput } from "./types.js";

/** Normalize a {@link UnitsInput} (bigint | number | string) to a bigint. */
export function toBigIntUnits(value: UnitsInput): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new RangeError(`not an integer-unit string: ${JSON.stringify(value)}`);
    }
    return BigInt(value.trim());
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`units must be an integer, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    // Above 2**53 a JS number can't represent an exact integer. Force the
    // caller to pass a bigint or string so we never silently lose units.
    throw new RangeError(
      `units ${value} exceeds Number.MAX_SAFE_INTEGER — pass a bigint or string`,
    );
  }
  return BigInt(value);
}

/**
 * Convert a human-readable decimal amount to smallest units.
 *
 * `toUnits("1.5", 9)` → `1500000000n`. Parsing is exact (string-based); extra
 * fractional digits beyond `decimals` are rejected rather than rounded, so you
 * never accidentally truncate a user's money.
 */
export function toUnits(amount: string | number, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const str = typeof amount === "number" ? numberToPlainString(amount) : amount.trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(str);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new RangeError(`invalid decimal amount: ${JSON.stringify(amount)}`);
  }
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = m[2] || "0";
  const frac = m[3] ?? "";
  if (frac.length > decimals) {
    throw new RangeError(
      `amount ${JSON.stringify(amount)} has more than ${decimals} fractional digits`,
    );
  }
  const fracPadded = frac.padEnd(decimals, "0");
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return sign * BigInt(combined);
}

/**
 * Convert smallest units back to a human-readable decimal string.
 *
 * `fromUnits(1500000000n, 9)` → `"1.5"`. Returns a string (not a number) so
 * large balances don't lose precision; trailing zeros are trimmed.
 */
export function fromUnits(units: UnitsInput, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const v = toBigIntUnits(units);
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = abs.slice(0, abs.length - decimals) || "0";
  const frac = decimals === 0 ? "" : abs.slice(abs.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Apply a slippage tolerance to an expected output and floor it — the minimum
 * you'll accept from a swap or LP mint.
 *
 * `applySlippage(1000n, 0.01)` → `990n` (tolerate 1% less). Tolerance is a
 * fraction in `[0, 1)`. Rounding is toward zero (never rounds the floor UP,
 * which would let a worse-than-tolerated trade through).
 */
export function applySlippage(expectedUnits: UnitsInput, tolerance: number): bigint {
  if (!(tolerance >= 0) || tolerance >= 1) {
    throw new RangeError(`slippage tolerance must be in [0, 1), got ${tolerance}`);
  }
  const expected = toBigIntUnits(expectedUnits);
  // Use 1e9 fixed-point so a float tolerance doesn't infect the integer math.
  const PRECISION = 1_000_000_000n;
  const keepBps = PRECISION - BigInt(Math.round(tolerance * Number(PRECISION)));
  return (expected * keepBps) / PRECISION;
}

// ---- internal -----------------------------------------------------------

/** Render a JS number without scientific notation (rejects non-finite). */
function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`amount must be finite, got ${n}`);
  if (!n.toString().includes("e") && !n.toString().includes("E")) return n.toString();
  // Expand exponential form (e.g. 1e-7) to a plain decimal.
  const [, sign, digits, expRaw] = /^(-?)(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(n.toString())!;
  const exp = Number(expRaw);
  const [int, frac = ""] = digits.split(".");
  if (exp >= 0) {
    const shifted = frac.padEnd(exp, "0");
    return `${sign}${int}${shifted.slice(0, exp)}${shifted.slice(exp) ? `.${shifted.slice(exp)}` : ""}`;
  }
  const zeros = "0".repeat(-exp - 1);
  return `${sign}0.${zeros}${int}${frac}`;
}
