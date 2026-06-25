# Changelog

## 0.4.0 — 2026-06-25

TON Connect authentication + a session-cookie fix. Verified against the
production backend.

- **`TegroFinanceAuthClient`** — opens a staking session from a TON Connect
  `ton_proof`: `getPayload()` (challenge), `login(req)` → `{ token }`,
  `refreshToken()`. Plus `tonProofToLoginRequest(wallet, { affiliateAddress?,
  tgInitData? })` to map a connected wallet's signed proof into the login body.
  Endpoints under `/api/v1/auth/`; the proof is **not** domain-locked, so a
  Mini App on any origin can authenticate against a Tegro-issued payload.
- **Fix (session cookie name)**: the backend reads the session cookie as
  **`tegro-dex`**, not `token`. `TegroFinanceStakingClient` now sends that name
  (configurable via `cookieName`). The server-side `sessionToken` path in 0.3.0
  used the wrong name and would not authenticate — upgrade to 0.4.0 for it.
- Login body fields corrected to the backend contract: `affiliate_address` /
  `tg_init_data` (were mis-named after a stale frontend reference).
- `examples/auth.ts`. Token TTL is 48h (auto-refreshes past half-life); the
  challenge payload TTL is 20 min and the proof timestamp window is 5 min.

## 0.3.0 — 2026-06-24

Liquid staking (stgTON) — stake/unstake/claim, additive and non-breaking.

- `TegroFinanceStakingClient` — typed client over the liquid-staking HTTP API:
  - read (open): `getPools()`, `getPoolData(master)`;
  - build (→ TON Connect message list): `buildStake`, `buildUnstake`, `buildClaim`;
  - read (auth): `getWithdrawals(master)` (pending vouchers + 72h timers).
  - Builders reuse the existing `TransactionData` shape and `toTonConnectMessages`.
- Session handling: builder/withdrawal endpoints are cookie-authenticated. In a
  browser dApp the cookie travels via `credentials: "include"`; on a server pass
  `sessionToken` (or `setSessionToken`). A 401/403 surfaces as the new
  `TegroFinanceStakingAuthError`. Default origin is `https://tegro.finance` (the
  cookie's scope), not `api.tegro.finance`.
- Rate helpers `stgTonToTon` / `tonToStgTon` — exact BigInt conversion at a pool's
  `price`; documented as display estimates (exclude the 0.5% redeem fee and gas).
- Types verified against the live backend: `StakingPool` carries `in_asset` /
  `out_asset` / `fees`, and `apy` is a **percent number** (e.g. `16.97`), not a
  fraction.
- `examples/staking.ts` (`npm run example:staking`) + `tests/staking.test.ts`.

## 0.2.1 — 2026-06-09

Security hardening (no API changes).

- Replace three anchored-quantifier regexes (`/\/+$/`, `/0+$/`) with linear
  string trims in `client.ts`, `contracts/provider.ts`, and `amounts.ts`.
  Removes a polynomial-backtracking (ReDoS) class flagged by CodeQL; behavior
  is unchanged. `src/` ships to consumers, so this lands as a patch release.
- Dev-dependency bumps (vitest/vite/esbuild, GitHub Actions) via Dependabot —
  dev-only, never part of the published package.

## 0.2.0 — 2026-06-09

On-chain mode — build transactions client-side, without the Tegro backend.

- `TegroFinanceRouter` — assembles swap / provide / remove / create / unlock-pool
  transactions entirely on the client (STON.fi-grade), returning a ready
  `tonConnectUI.sendTransaction()` request. No dependency on `/api/v1/swap`.
- Pure cell builders (`buildSwapBody`, `buildJettonTransferBody`,
  `buildPtonTonTransferBody`, `buildProvideLiquidityBody`, `buildBurnBody`,
  `buildUpdatePoolStatusBody`) and `OpCodes` / `Gas` constants — ported
  verbatim from the production backend (STON.fi V2.2 router fork).
- **Every body verified byte-for-byte** against the backend's `pytoniq_core`
  output by cell root-hash (8 vectors in `tests/contracts.cells.test.ts`).
- `JettonWalletResolver` interface + `tonApiResolver()` (over tonapi.io) and
  `cachingResolver()` — resolve `get_wallet_address` without bundling a TON RPC.
- New dependency: `@ton/core` (cells). The HTTP/quote layer stays
  dependency-free; `@tonconnect/ui` remains an optional peer.
- 15 new tests (40 total).

No breaking changes to the 0.1.0 HTTP-client surface.

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
