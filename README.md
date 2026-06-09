# @tegroton/tegro-finance

[![npm version](https://img.shields.io/npm/v/@tegroton/tegro-finance.svg?logo=npm&label=npm)](https://www.npmjs.com/package/@tegroton/tegro-finance)
[![npm downloads](https://img.shields.io/npm/dm/@tegroton/tegro-finance.svg)](https://www.npmjs.com/package/@tegroton/tegro-finance)
[![CI](https://img.shields.io/github/actions/workflow/status/TegroTON/tegro-finance-sdk/ci.yml?branch=main&label=CI&logo=github)](https://github.com/TegroTON/tegro-finance-sdk/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/TegroTON/tegro-finance-sdk/codeql.yml?branch=main&label=CodeQL&logo=github)](https://github.com/TegroTON/tegro-finance-sdk/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@tegroton/tegro-finance.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](src/index.ts)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673)](https://www.conventionalcommits.org)

Production-ready TypeScript SDK for the **[Tegro Finance](https://tegro.finance)** DEX — an AMM on **The Open Network (TON)**. It ships **two integration modes**:

- **API mode** — a thin, typed HTTP client over the public Tegro Finance API (read pools/assets, quote, and have the backend prepare transactions).
- **On-chain mode** — build swap & liquidity transactions **entirely client-side** with `TegroFinanceRouter`, with **no dependency on our backend** (the STON.fi-grade path). Every message body is verified byte-for-byte against the production contracts.

Surface at a glance:

- **Read** — `getPools()`, `getAssets()`, `getTokenData()`, `getPoolsForWallet()`.
- **Quote** — `simulateSwap()`, `simulateReverseSwap()`, `simulateProvideLiquidity()`.
- **Build (API)** — `buildSwap()`, `buildProvideLiquidity()`, `buildRemoveLiquidity()`, `buildCreatePool()` → a ready-to-sign TON Connect message list.
- **Build (on-chain)** — `TegroFinanceRouter.getSwapTxParams()`, `getProvideLiquidityTxParams()`, `getRemoveLiquidityTxParams()`, `getCreatePoolTxParams()`.
- **Helpers** — `toUnits` / `fromUnits` (BigInt-exact), `applySlippage`, `toTonConnectMessages`.

> **Non-custodial by design.** Every state change is authorized by the user's wallet via TON Connect. The backend returns a prepared message payload; this SDK maps it to the wallet's `sendTransaction` shape and passes the BOC through untouched. **The SDK never holds, sees, or transmits a private key.**

> **Status:** verified against the live `tegro.finance` API on 2026-06-09 (read, quote, and error paths exercised end-to-end).

---

## Why this exists

Integrating a TON AMM means juggling smallest-unit math, slippage flooring, the swap/liquidity request shapes, and the exact object `tonConnectUI.sendTransaction()` wants. Everyone writes the same glue. This package is that glue — typed, tested, MIT-licensed — so your app can quote a swap and hand a transaction to the wallet in a dozen lines.

## Install

```bash
npm install @tegroton/tegro-finance
# or
pnpm add @tegroton/tegro-finance
```

Node.js ≥ 18 required (uses global `fetch` and `AbortController`). Works in the browser too. TON Connect is an **optional** peer dependency — you only need it on the frontend that actually signs.

## Quick start

### Read pools and tokens

```ts
import { TegroFinanceClient } from "@tegroton/tegro-finance";

const client = new TegroFinanceClient(); // defaults to https://api.tegro.finance

const pools = await client.getPools();
const assets = await client.getAssets(); // { [contractAddress]: Asset }

console.log(`${pools.length} pools, ${Object.keys(assets).length} tokens`);
```

### Quote a swap

```ts
import { TegroFinanceClient, toUnits, fromUnits, TON_NATIVE_ADDRESS } from "@tegroton/tegro-finance";

const client = new TegroFinanceClient();
const assets = await client.getAssets();
const tgr = Object.values(assets).find((a) => a.symbol === "TGR")!;

const quote = await client.simulateSwap({
  offerAddress: TON_NATIVE_ADDRESS,
  askAddress: tgr.contract_address,
  units: toUnits("1", 9), // 1 TON in nanotons
  slippageTolerance: 0.01, // 1%
});

console.log(`1 TON → ~${fromUnits(quote.ask_units, tgr.decimals)} TGR`);
console.log(`price impact ${(quote.price_impact * 100).toFixed(3)}%`);
```

### Build a swap and let the wallet sign it (TON Connect)

```ts
import {
  TegroFinanceClient,
  toUnits,
  applySlippage,
  toTonConnectMessages,
  TON_NATIVE_ADDRESS,
} from "@tegroton/tegro-finance";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";

const client = new TegroFinanceClient();
const [tonConnectUI] = useTonConnectUI();
const userAddress = useTonAddress();

const offerUnits = toUnits("1", 9);
const quote = await client.simulateSwap({
  offerAddress: TON_NATIVE_ADDRESS,
  askAddress: tgrAddress,
  units: offerUnits,
  slippageTolerance: 0.01,
});

const tx = await client.buildSwap({
  userWalletAddress: userAddress,
  offerJettonAddress: TON_NATIVE_ADDRESS,
  offerAmount: offerUnits,
  askJettonAddress: tgrAddress,
  minAskAmount: applySlippage(quote.ask_units, 0.01), // floor it yourself
});

// The ONLY place a signature happens — the SDK never sees a key.
await tonConnectUI.sendTransaction(toTonConnectMessages(tx));
```

### On-chain mode — build without our backend

If you don't want a dependency on the Tegro API for transaction building, use
`TegroFinanceRouter`. It assembles the **exact same** message the backend would
(verified byte-for-byte against the production contracts) using only `@ton/core`
and a jetton-wallet resolver over any TON RPC:

```ts
import { TegroFinanceRouter, tonApiResolver, cachingResolver, applySlippage } from "@tegroton/tegro-finance";

const router = new TegroFinanceRouter({
  routerAddress: "EQAbKJUWn1oWVPkvp78vkmt0E7gA929rIbP33XAISzWTelct", // read from /api/v1/pools
  proxyTonAddress: "EQDzeU94K3aDdAfqB-NLcaCfTwUMzbpFmlrTpwM_xpQRrtgs", // the router's pTON wallet master
  resolver: cachingResolver(tonApiResolver()), // or your own @ton/ton-based resolver
});

const tx = await router.getSwapTxParams({
  userWalletAddress: userAddress,
  offerJettonAddress: TON_NATIVE_ADDRESS,
  offerAmount: toUnits("1", 9),
  askJettonAddress: tgrAddress,
  minAskAmount: applySlippage(expectedOut, 0.01),
});

await tonConnectUI.sendTransaction(tx); // already TON Connect-shaped
```

`getProvideLiquidityTxParams`, `getCreatePoolTxParams`, `getRemoveLiquidityTxParams`
and `getUnlockPoolTxParams` work the same way. Resolve `routerAddress` and the
pool/pTON addresses from `/api/v1/pools` — never hardcode them long-term.

Full runnable examples: [`examples/list-pools.ts`](examples/list-pools.ts), [`examples/quote-and-swap.ts`](examples/quote-and-swap.ts), [`examples/tonconnect-react.tsx`](examples/tonconnect-react.tsx).

---

## Core concepts (read this once)

### Units are integers in the smallest denomination

The API speaks "units" — `10**decimals` of a token (nanotons for TON). Convert with the BigInt-exact helpers; never use floating-point math on money:

```ts
toUnits("1.5", 9)        // → 1500000000n
fromUnits(1500000000n, 9) // → "1.5"
```

`toUnits` **rejects** more fractional digits than the token has decimals instead of silently truncating. Outgoing amounts accept `bigint | number | string` and are serialized as real JSON integers, so values above `2**53` keep full precision on the wire.

### Slippage is your floor, computed locally

```ts
applySlippage(quote.ask_units, 0.01) // tolerate 1% less; rounds toward zero
```

Pass the result as `minAskAmount` / `minLpOut`. It rounds the floor **down**, so a worse-than-tolerated trade can never slip through.

### Fees are hundredths of a percent

`lp_fee: 20` means **0.20%**. Divide by 100 for a percentage.

### The wallet signs, not the SDK

`buildSwap` / `buildProvideLiquidity` / `buildRemoveLiquidity` / `buildCreatePool` / `buildUnlockPool` return `TransactionData` (`{ valid_until, messages[] }`). Feed it through `toTonConnectMessages()` and hand the result to the wallet. The payload BOC is opaque — pass it through unchanged.

---

## API reference

### `new TegroFinanceClient(options?)`

```ts
type TegroFinanceClientOptions = {
  apiBase?: string;     // default "https://api.tegro.finance" ("https://tegro.finance" also works)
  fetch?: typeof fetch; // inject for tests / proxies / retry wrappers
  timeoutMs?: number;   // per-request timeout, default 15000 (0 disables)
};
```

#### Read

| Method | Endpoint | Returns |
|---|---|---|
| `getPools()` | `GET /api/v1/pools` | `Pool[]` |
| `getPoolsForToken(addr)` | `GET /api/v1/pools/{addr}` | `Pool[]` |
| `getPoolsForWallet(addr)` | `GET /api/v1/wallet/{addr}/get_pools` | `Pool[]` (with `lp_balance`) |
| `getPoolsPairs()` | `GET /api/v1/pools-pairs` | `Pair[]` |
| `getPoolsPairsForToken(addr)` | `GET /api/v1/pools-pairs/for/{addr}` | `Pair[]` |
| `getAssets()` | `GET /api/v1/assets` | `AssetMap` |
| `getAssetList()` | (derived) | `Asset[]` |
| `getTokenData(addr)` | `GET /api/v1/tokens/{addr}/data` | `TokenData` |
| `tokenLogoUrl(addr)` | (URL builder) | `string` |

#### Quote

| Method | Endpoint | Returns |
|---|---|---|
| `simulateSwap(p)` | `POST /api/v1/swap/simulate` | `SwapSimulation` |
| `simulateReverseSwap(p)` | `POST /api/v1/reverse_swap/simulate` | `SwapSimulation` |
| `simulateProvideLiquidity(p)` | `POST /api/v1/dex/liquidity/provide/simulate` | `ProvideLiquiditySimulation` |

Quote methods throw `TegroFinanceDexError` (with `.code`: `21` pool-not-found, `22` insufficient-liquidity, `23` wrong-action) when the API returns an error envelope.

#### Build (→ TON Connect message list)

| Method | Endpoint |
|---|---|
| `buildSwap(p)` | `POST /api/v1/swap` |
| `buildProvideLiquidity(p)` | `POST /api/v1/dex/liquidity/provide` |
| `buildCompleteProvideLiquidity(p)` | `POST /api/v1/dex/liquidity/provide_complete` |
| `buildCompleteProvideLiquidityActivate(p)` | `POST /api/v1/dex/liquidity/provide_complete_activate` |
| `buildRemoveLiquidity(p)` | `POST /api/v1/dex/liquidity/remove` |
| `buildCreatePool(p)` | `POST /api/v1/dex/liquidity/create` |
| `buildUnlockPool(p)` | `POST /api/v1/dex/pool/unlock` |

#### On-chain (`new TegroFinanceRouter({ routerAddress, proxyTonAddress, resolver })`)

Builds the same transactions client-side — no backend call for tx construction.
Each method returns a TON Connect request (`{ validUntil, messages }`).

| Method | Builds |
|---|---|
| `getSwapTxParams(p)` | swap (TON↔jetton, jetton↔jetton) |
| `getProvideLiquidityTxParams(p)` | add liquidity (one message per non-zero side) |
| `getCreatePoolTxParams(p)` | create a pool (two-sided provide on a new pair) |
| `getRemoveLiquidityTxParams(p)` | burn LP at the user's LP wallet |
| `getUnlockPoolTxParams(p)` | admin `update_pool_status` (pool unlock) |

Resolvers: `tonApiResolver(opts?)` (over tonapi.io), `cachingResolver(inner)`, or any object implementing `JettonWalletResolver`. Low-level cell builders (`buildSwapBody`, `buildJettonTransferBody`, `buildPtonTonTransferBody`, `buildProvideLiquidityBody`, `buildBurnBody`, `buildUpdatePoolStatusBody`) and the `OpCodes` / `Gas` constants are exported too.

### Helpers

```ts
toUnits(amount, decimals): bigint
fromUnits(units, decimals): string
toBigIntUnits(value): bigint
applySlippage(expectedUnits, tolerance): bigint
toTonConnectMessages(tx, validForSecs?): { validUntil, messages }
```

### Errors

- `TegroFinanceApiError` — transport failure, timeout, or non-2xx HTTP. Carries `.status` and `.raw`.
- `TegroFinanceDexError` — a simulate endpoint returned `{type:"error", code, message}`. Carries `.code`.

---

## A note on precision

Outgoing amounts are exact (BigInt → unquoted JSON integers). **Incoming** numeric fields (`ask_units`, `fee_units`, reserves, …) are typed as `number` because the upstream encodes them as JSON numbers — values above `2**53` may lose precision. For the realistic nanoton ranges the app trades in this is non-issue; if you need exact reads of very large amounts, fetch the raw response and parse those fields as BigInt yourself.

## Tests

```bash
npm test          # vitest, network mocked
npx tsc --noEmit  # type check
```

The suite (40 tests) covers amount math (round-trips, truncation rejection, unsafe-integer guards), request shaping, BigInt-on-the-wire serialization, the DEX-error envelope, the TON Connect mapping, the on-chain Router routing, and **byte-for-byte cell-hash equality of every on-chain body against the production backend** (`pytoniq_core`).

## Roadmap / non-goals

✅ Implemented
- Read: pools, pairs, assets, token data, wallet positions
- Quote: swap, reverse swap, provide-liquidity
- Build (API): swap, provide / complete / activate, remove, create pool, unlock pool
- **Build (on-chain): client-side swap / provide / remove / create / unlock, verified byte-for-byte against the production contracts**
- BigInt-exact units + slippage helpers
- TON Connect message adapter
- One runtime dep (`@ton/core`); the HTTP/quote layer is dependency-free

🚧 Not yet (PRs welcome)
- IDO / launchpad endpoints
- Multi-hop route helper
- A lossless BigInt response parser

❌ Out of scope
- **No key management, no signing** — that's the wallet's job, by design.
- No database, no order tracking — bring your own.
- No on-chain indexing — read the API or your own indexer.
- Staking lives in a separate project, not this SDK.

---

## See also

- [Tegro Finance docs](https://docs.tegro.finance) — concepts, contracts, fees, API reference.
- [TON Connect](https://docs.ton.org/develop/dapps/ton-connect/overview) — the wallet-authorization protocol used to sign.
- [TON developer docs](https://docs.ton.org) — The Open Network platform reference.

## Security

If you find a vulnerability, **do not open a public issue**. Use [GitHub Private Vulnerability Reporting](https://github.com/TegroTON/tegro-finance-sdk/security/advisories/new). Full policy in [SECURITY.md](SECURITY.md).

## Contributing

PRs welcome — the SDK is intentionally minimal. See [CONTRIBUTING.md](CONTRIBUTING.md). New runtime dependencies are a hard sell; tests for new behavior are mandatory.

## Changelog

Versioned by [Semantic Versioning](https://semver.org/). See [CHANGELOG.md](CHANGELOG.md). Releases are tagged `v<MAJOR>.<MINOR>.<PATCH>` and trigger an automatic npm publish.

## Links

- 🔁 **Tegro Finance DEX** — https://tegro.finance
- 📖 **Docs** — https://docs.tegro.finance
- 💬 **Community** — https://t.me/TegroFinance
- 🐙 **Source** — https://github.com/TegroTON/tegro-finance-sdk
