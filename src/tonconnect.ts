// TON Connect adapter.
//
// Every "build" endpoint returns a backend-prepared {@link TransactionData}.
// The wallet signs it. This maps that shape to exactly what
// `@tonconnect/ui`'s `sendTransaction()` expects — no @ton/core, no cell
// building, no key material. The payload BOC is passed through untouched.

import type { TransactionData } from "./types.js";

/** A single message in a TON Connect `sendTransaction` request. */
export interface TonConnectMessage {
  address: string;
  /** Nanotons, as a string (TON Connect requires string amounts). */
  amount: string;
  /** Base64 BOC, omitted when the backend sent none. */
  payload?: string;
}

/** The object shape accepted by `tonConnectUI.sendTransaction(...)`. */
export interface TonConnectTransactionRequest {
  validUntil: number;
  messages: TonConnectMessage[];
}

/**
 * Convert backend {@link TransactionData} into a TON Connect request.
 *
 * ```ts
 * const tx = await client.buildSwap({ ... });
 * await tonConnectUI.sendTransaction(toTonConnectMessages(tx));
 * ```
 *
 * @param tx           the build-endpoint response
 * @param validForSecs optional override; when set, `validUntil` becomes
 *                     `now + validForSecs` instead of trusting the backend's
 *                     (useful if the client clock and the user's diverge).
 */
export function toTonConnectMessages(
  tx: TransactionData,
  validForSecs?: number,
): TonConnectTransactionRequest {
  const validUntil =
    validForSecs !== undefined
      ? Math.floor(Date.now() / 1000) + validForSecs
      : tx.valid_until;

  return {
    validUntil,
    messages: tx.messages.map((m) => ({
      address: m.to,
      amount: String(m.amount),
      ...(m.payload != null && m.payload !== "" ? { payload: m.payload } : {}),
    })),
  };
}
