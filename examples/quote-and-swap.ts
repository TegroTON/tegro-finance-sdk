// Quote a swap, apply slippage, and build the transaction a wallet would sign.
// Prints the TON Connect message list — it does NOT send anything (no keys).
//
// Run: npx tsx examples/quote-and-swap.ts
//
// Swaps 1 TON → TGR. Adjust the addresses/amount for your pair.

import {
  TegroFinanceClient,
  toUnits,
  fromUnits,
  applySlippage,
  toTonConnectMessages,
  TON_NATIVE_ADDRESS,
} from "../src/index.js";

const client = new TegroFinanceClient();

// Resolve TGR's address + decimals from the live registry (never hardcode).
const assets = await client.getAssets();
const tgr = Object.values(assets).find((a) => a.symbol === "TGR");
if (!tgr) throw new Error("TGR not found in the asset registry");

const TON = TON_NATIVE_ADDRESS;
const offerUnits = toUnits("1", 9); // 1 TON
const slippage = 0.01; // 1%

// 1) Quote.
const quote = await client.simulateSwap({
  offerAddress: TON,
  askAddress: tgr.contract_address,
  units: offerUnits,
  slippageTolerance: slippage,
});

console.log(`1 TON → ~${fromUnits(quote.ask_units, tgr.decimals)} ${tgr.symbol}`);
console.log(`price impact ${(quote.price_impact * 100).toFixed(3)}%, fee ${quote.fee_percent}%`);

// 2) Floor the output ourselves (don't trust a server-supplied min blindly).
const minAsk = applySlippage(quote.ask_units, slippage);

// 3) Build the signable transaction.
const tx = await client.buildSwap({
  userWalletAddress: "EQyour_wallet_address_here____________________________",
  offerJettonAddress: TON,
  offerAmount: offerUnits,
  askJettonAddress: tgr.contract_address,
  minAskAmount: minAsk,
});

// 4) In a browser you'd now do:
//      await tonConnectUI.sendTransaction(toTonConnectMessages(tx));
console.log("\nTON Connect request:");
console.log(JSON.stringify(toTonConnectMessages(tx), null, 2));
