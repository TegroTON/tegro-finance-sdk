import { describe, it, expect } from "vitest";
import { Cell } from "@ton/core";
import { TegroFinanceRouter } from "../src/contracts/router.js";
import type { JettonWalletResolver } from "../src/contracts/provider.js";
import { OpCodes } from "../src/contracts/constants.js";
import { TON_NATIVE_ADDRESS } from "../src/types.js";

const ROUTER = "EQAbKJUWn1oWVPkvp78vkmt0E7gA929rIbP33XAISzWTelct";
const PTON = "EQDzeU94K3aDdAfqB-NLcaCfTwUMzbpFmlrTpwM_xpQRrtgs";
const USER = "UQDtQC7uH71YX232JZCdjUGsKvKsv8Kqh6He4y8D3eGMErdU";
const USDT = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const TGR = "EQBaAMBEi5TUgPUqmEtPZ4pDO4dgItw9h2N6UuFQwugzG0Ul";

// Deterministic stub: records (minter, owner) lookups and returns a real,
// parseable address. We assert routing (which lookups happen), not identity.
function stubResolver(): JettonWalletResolver & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    async getWalletAddress(minter: string, owner: string) {
      calls.push([minter, owner]);
      // Return a real, parseable address; identity isn't asserted, routing is.
      return USDT;
    },
  };
}

function opOf(payloadB64: string): number {
  return Cell.fromBase64(payloadB64).beginParse().loadUint(32);
}
function innerRefOp(payloadB64: string): number {
  const s = Cell.fromBase64(payloadB64).beginParse();
  s.loadUint(32); // outer op
  // skip to the ref (the forward payload) — read it as the last ref
  const refs = Cell.fromBase64(payloadB64).refs;
  return refs[refs.length - 1].beginParse().loadUint(32);
}

describe("TegroFinanceRouter.getSwapTxParams", () => {
  it("TON → jetton: pTON ton_transfer, amount = forward + offer", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getSwapTxParams({
      userWalletAddress: USER,
      offerJettonAddress: TON_NATIVE_ADDRESS,
      offerAmount: 1_000_000_000n,
      askJettonAddress: TGR,
      minAskAmount: 1_683_000n,
    });
    expect(tx.messages).toHaveLength(1);
    // 300000000 (SWAP_TON_TO_JETTON_FORWARD) + 1000000000 offer
    expect(tx.messages[0].amount).toBe("1300000000");
    expect(opOf(tx.messages[0].payload!)).toBe(OpCodes.PTON_TON_TRANSFER);
    expect(innerRefOp(tx.messages[0].payload!)).toBe(OpCodes.CROSS_SWAP);
    // resolves router's pTON wallet + router's ask(TGR) wallet
    expect(resolver.calls).toContainEqual([PTON, ROUTER]);
    expect(resolver.calls).toContainEqual([TGR, ROUTER]);
  });

  it("jetton → jetton: jetton transfer, gas = SWAP (0.22)", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getSwapTxParams({
      userWalletAddress: USER,
      offerJettonAddress: USDT,
      offerAmount: 5_000_000n,
      askJettonAddress: TGR,
      minAskAmount: 1n,
    });
    expect(tx.messages[0].amount).toBe("220000000");
    expect(opOf(tx.messages[0].payload!)).toBe(OpCodes.JETTON_TRANSFER);
    // user's offer wallet + router's ask wallet
    expect(resolver.calls).toContainEqual([USDT, USER]);
    expect(resolver.calls).toContainEqual([TGR, ROUTER]);
  });

  it("jetton → TON: gas = SWAP_JETTON_TO_TON (0.17), ask normalized to pTON", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getSwapTxParams({
      userWalletAddress: USER,
      offerJettonAddress: USDT,
      offerAmount: 5_000_000n,
      askJettonAddress: TON_NATIVE_ADDRESS,
      minAskAmount: 1n,
    });
    expect(tx.messages[0].amount).toBe("170000000");
    expect(resolver.calls).toContainEqual([PTON, ROUTER]); // ask TON → router's pTON wallet
  });
});

describe("TegroFinanceRouter liquidity", () => {
  it("two-sided provide emits one message per non-zero side", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getProvideLiquidityTxParams({
      userWalletAddress: USER,
      token0Address: TON_NATIVE_ADDRESS,
      token1Address: USDT,
      token0Amount: 1_000_000_000n,
      token1Amount: 5_000_000n,
      minLpOutUnits: 1n,
    });
    expect(tx.messages).toHaveLength(2);
    // TON side is a pTON wrap; jetton side is a TEP-74 transfer
    expect(opOf(tx.messages[0].payload!)).toBe(OpCodes.PTON_TON_TRANSFER);
    expect(opOf(tx.messages[1].payload!)).toBe(OpCodes.JETTON_TRANSFER);
    expect(tx.messages[1].amount).toBe("300000000"); // PROVIDE_LP
  });

  it("single-sided provide emits one message", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getProvideLiquidityTxParams({
      userWalletAddress: USER,
      token0Address: USDT,
      token1Address: TGR,
      token0Amount: 5_000_000n,
      token1Amount: 0n,
      minLpOutUnits: 1n,
    });
    expect(tx.messages).toHaveLength(1);
  });

  it("remove liquidity burns LP at the user's LP wallet", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const pool = "EQCK0N7UtOgKhzm8sop8mByZCLF3WPtRTJ142ABIcudKUNLd";
    const tx = await router.getRemoveLiquidityTxParams({
      userWalletAddress: USER,
      poolAddress: pool,
      lpUnits: 100n,
    });
    expect(tx.messages).toHaveLength(1);
    expect(tx.messages[0].amount).toBe("500000000"); // BURN_LIQUIDITY
    expect(opOf(tx.messages[0].payload!)).toBe(OpCodes.BURN_LIQUIDITY);
    expect(resolver.calls).toContainEqual([pool, USER]); // LP wallet = wallet(pool, user)
  });

  it("unlock pool sends update_pool_status to the router", async () => {
    const resolver = stubResolver();
    const router = new TegroFinanceRouter({ routerAddress: ROUTER, proxyTonAddress: PTON, resolver });
    const tx = await router.getUnlockPoolTxParams({
      token0Address: TON_NATIVE_ADDRESS,
      token1Address: USDT,
      excessesRecipient: USER,
    });
    expect(tx.messages[0].address).toBe(ROUTER);
    expect(opOf(tx.messages[0].payload!)).toBe(OpCodes.UPDATE_POOL_STATUS);
  });
});
