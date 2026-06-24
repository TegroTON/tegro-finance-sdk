// Tegro liquid staking (stgTON): read pools + live rate, then show the
// build→sign shape for stake/unstake/claim. Reads need no wallet; the builders
// need a TON Connect session (browser cookie, or a server-side `sessionToken`).
//
// Run the read part: npx tsx examples/staking.ts

import {
  TegroFinanceStakingClient,
  toTonConnectMessages,
  stgTonToTon,
  tonToStgTon,
  fromUnits,
} from "../src/index.js";

const staking = new TegroFinanceStakingClient();

// --- 1. Read pools (open) ---------------------------------------------------
const pools = await staking.getPools();
console.log(`${pools.length} staking pools:\n`);
for (const p of pools) {
  const flag = p.is_active ? "●" : "○";
  const min = fromUnits(p.min_offer_amount, p.in_asset.decimals);
  console.log(
    `${flag} ${p.in_asset.symbol.padEnd(8)} → ${p.out_asset.symbol.padEnd(10)} ` +
      `APY ${p.apy.toFixed(2)}%   min ${min} ${p.in_asset.symbol}   ${p.out_asset.contract_address}`,
  );
}

// --- 2. Live rate on the active stgTON pool --------------------------------
const active = pools.find((p) => p.is_active && p.out_asset.symbol === "stgTON");
if (active) {
  const master = active.out_asset.contract_address;
  const { price } = await staking.getPoolData(master);
  console.log(`\nstgTON rate: 1 stgTON = ${fromUnits(price, 9)} TON`);
  console.log(`  stake 100 TON  ≈ ${fromUnits(tonToStgTon(100_000_000_000n, price), 9)} stgTON`);
  console.log(`  hold  100 stgTON ≈ ${fromUnits(stgTonToTon(100_000_000_000n, price), 9)} TON`);

  // --- 3. Build a stake tx (needs a session) — shape only -------------------
  // In a browser dApp the session cookie is set by TON Connect auth, so:
  //
  //   const tx = await staking.buildStake({ masterAddress: master, offerAmount: 5_000_000_000n });
  //   await tonConnectUI.sendTransaction(toTonConnectMessages(tx));
  //
  // On a server pass the token explicitly:
  //   new TegroFinanceStakingClient({ sessionToken: "<token cookie>" })
  //
  // Unstake → 72h voucher → claim:
  //   await staking.buildUnstake({ masterAddress: master, sharesAmount: 5_000_000_000n });
  //   const pending = await staking.getWithdrawals(master);   // { claim_after, claimable }
  //   await staking.buildClaim({ masterAddress: master, voucherAddress: pending[0].voucher_address });
  void toTonConnectMessages;
}
