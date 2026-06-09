// List Tegro Finance pools and the token registry. Pure read, no wallet.
//
// Run: npx tsx examples/list-pools.ts

import { TegroFinanceClient, fromUnits } from "../src/index.js";

const client = new TegroFinanceClient();

const [pools, assets] = await Promise.all([client.getPools(), client.getAssets()]);

const symbolOf = (addr: string) => assets[addr]?.symbol ?? `${addr.slice(0, 6)}…`;

console.log(`${pools.length} pools, ${Object.keys(assets).length} assets\n`);

for (const p of pools.slice(0, 20)) {
  const pair = `${symbolOf(p.token0_address)}/${symbolOf(p.token1_address)}`;
  const fee = ((p.lp_fee ?? 0) / 100).toFixed(2);
  const tvl = p.lp_total_supply_usd != null ? `$${p.lp_total_supply_usd.toFixed(0)}` : "n/a";
  console.log(`${pair.padEnd(20)} fee ${fee}%   TVL ${tvl}   ${p.address}`);
}

// Reserves come back as floats already scaled to human units in this feed;
// `fromUnits` is the helper you'd use when reading *integer* unit fields.
void fromUnits;
