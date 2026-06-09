# Changelog

## 0.1.0 — 2026-06-09

Initial release.

- `TegroFinanceClient` — typed client over the public Tegro Finance DEX API:
  - **Read:** `getPools`, `getPoolsForToken`, `getPoolsForWallet`, `getPoolsPairs`, `getPoolsPairsForToken`, `getAssets`, `getAssetList`, `getTokenData`, `tokenLogoUrl`.
  - **Quote:** `simulateSwap`, `simulateReverseSwap`, `simulateProvideLiquidity`.
  - **Build:** `buildSwap`, `buildProvideLiquidity`, `buildCompleteProvideLiquidity`, `buildCompleteProvideLiquidityActivate`, `buildRemoveLiquidity`, `buildCreatePool`, `buildUnlockPool` — each returns a ready-to-sign `TransactionData`.
- Amount helpers: `toUnits` / `fromUnits` (BigInt-exact, reject over-precision), `toBigIntUnits`, `applySlippage` (floors toward zero).
- `toTonConnectMessages()` — maps `TransactionData` to the `tonConnectUI.sendTransaction()` shape, passing the BOC payload through untouched.
- BigInt units are serialized as unquoted JSON integers so amounts above `2**53` keep full precision on the wire.
- Typed errors: `TegroFinanceApiError` (transport / non-2xx) and `TegroFinanceDexError` (simulate error envelope, with numeric `code`).
- `TON_NATIVE_ADDRESS` sentinel and `DexErrorCode` enum exported.
- Zero runtime dependencies. TON Connect is an optional peer dependency.
- Vitest suite (25 tests) covering amount math, request shaping, BigInt-on-the-wire, the DEX-error envelope, and the TON Connect mapping. Verified end-to-end against the live `tegro.finance` API on 2026-06-09.
