// Build a swap fully client-side (no Tegro backend) and print the TON Connect
// request. Resolves the router address from the live pool list, resolves jetton
// wallets via tonapi.io, and assembles the message with TegroFinanceRouter.
//
// Run: npx tsx examples/onchain-swap.ts
//
// It does NOT send anything — there are no keys here. In a browser you would
// pass the printed object to tonConnectUI.sendTransaction(...).

import {
  TegroFinanceClient,
  TegroFinanceRouter,
  tonApiResolver,
  cachingResolver,
  toUnits,
  fromUnits,
  applySlippage,
  TON_NATIVE_ADDRESS,
} from "../src/index.js";

const client = new TegroFinanceClient();

// 1) Discover the router + pTON addresses from a live pool (never hardcode).
const pools = await client.getPools();
const assets = await client.getAssets();
const tgr = Object.values(assets).find((a) => a.symbol === "TGR");
if (!tgr) throw new Error("TGR not in registry");

const tgrPool = pools.find(
  (p) => p.token0_address === tgr.contract_address || p.token1_address === tgr.contract_address,
);
if (!tgrPool) throw new Error("no TGR pool found");
const routerAddress = tgrPool.router_address;
// The pTON master is the non-TGR side of a TON/TGR pool, or read it from your config.
const proxyTonAddress =
  tgrPool.token0_address === tgr.contract_address ? tgrPool.token1_address : tgrPool.token0_address;

// 2) Quote (still via the API — quotes need pool math).
const offerUnits = toUnits("1", 9);
const quote = await client.simulateSwap({
  offerAddress: TON_NATIVE_ADDRESS,
  askAddress: tgr.contract_address,
  units: offerUnits,
  slippageTolerance: 0.01,
});
console.log(`1 TON → ~${fromUnits(quote.ask_units, tgr.decimals)} TGR`);

// 3) Build the transaction entirely on the client.
const router = new TegroFinanceRouter({
  routerAddress,
  proxyTonAddress,
  resolver: cachingResolver(tonApiResolver()),
});

const tx = await router.getSwapTxParams({
  userWalletAddress: "UQDtQC7uH71YX232JZCdjUGsKvKsv8Kqh6He4y8D3eGMErdU",
  offerJettonAddress: TON_NATIVE_ADDRESS,
  offerAmount: offerUnits,
  askJettonAddress: tgr.contract_address,
  minAskAmount: applySlippage(quote.ask_units, 0.01),
});

console.log("\nTON Connect request (client-built, no backend):");
console.log(JSON.stringify(tx, null, 2));
