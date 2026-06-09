import { describe, it, expect } from "vitest";
import {
  buildSwapBody,
  buildJettonTransferBody,
  buildPtonTonTransferBody,
  buildProvideLiquidityBody,
  buildBurnBody,
  buildUpdatePoolStatusBody,
} from "../src/contracts/cells.js";

// Fixed inputs identical to the cross-check oracle (.oracle.py / .oracle.ts).
// The expected hashes were produced by pytoniq_core — the exact library the
// production backend uses to build these bodies for mainnet. Equality here
// proves the @ton/core builders are byte-identical to what the live router
// accepts. If a builder changes layout, these hashes break — by design.
const ASK_WALLET = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USER = "UQDtQC7uH71YX232JZCdjUGsKvKsv8Kqh6He4y8D3eGMErdU";
const ROUTER = "EQAbKJUWn1oWVPkvp78vkmt0E7gA929rIbP33XAISzWTelct";
const REFERRAL = "EQBaAMBEi5TUgPUqmEtPZ4pDO4dgItw9h2N6UuFQwugzG0Ul";
const ROUTER_W = "EQCK0N7UtOgKhzm8sop8mByZCLF3WPtRTJ142ABIcudKUNLd";
const DEADLINE = 1800000000;
const MIN = 1683000n;
const AMT = 1000000000n;

const hash = (c: { hash(): Buffer }) => c.hash().toString("hex");

const swapRef = buildSwapBody({
  minAskAmount: MIN, askJettonWalletAddress: ASK_WALLET, refundAddress: USER,
  excessesAddress: USER, receiverAddress: USER, deadline: DEADLINE, referralAddress: REFERRAL,
});
const provide = buildProvideLiquidityBody({
  minLpOutUnits: MIN, routerWalletAddress: ROUTER_W, refundAddress: USER,
  excessesAddress: USER, receiverAddress: USER, deadline: DEADLINE, bothPositive: true,
});
const jt = (fwd: Parameters<typeof buildJettonTransferBody>[0]["forwardPayload"]) =>
  buildJettonTransferBody({ toAddress: ROUTER, jettonAmount: AMT, responseAddress: USER, forwardAmount: 175000000n, forwardPayload: fwd });

describe("cell builders match the pytoniq_core (backend) reference hashes", () => {
  it("swap body (with referral)", () => {
    expect(hash(swapRef)).toBe("79318291a48fc2b0dbe8e580b0f9c1e8723ce85ae376b95beee51c275decdc30");
  });

  it("swap body (no referral)", () => {
    const noref = buildSwapBody({
      minAskAmount: MIN, askJettonWalletAddress: ASK_WALLET, refundAddress: USER,
      excessesAddress: USER, receiverAddress: USER, deadline: DEADLINE, referralAddress: null,
    });
    expect(hash(noref)).toBe("c1102a12d3dc50e36171fe341fcc75ddbb5674f123a2b337f1a36e2e14eb2a9f");
  });

  it("jetton transfer wrapping a swap body", () => {
    expect(hash(jt(swapRef))).toBe("4caf6e9c04e7aae29f7f7efe9d305e4320cb78ee5c877e3bb99029e6fefecce3");
  });

  it("pTON ton_transfer wrapping a swap body", () => {
    const pton = buildPtonTonTransferBody({ tonAmount: AMT, refundAddress: USER, forwardPayload: swapRef });
    expect(hash(pton)).toBe("9458f85076c2b66512a29dea6b6ebf3b740564125927768fe26a63671a8c7bbb");
  });

  it("provide-liquidity body", () => {
    expect(hash(provide)).toBe("02793c5b7dbb4d89cbf27e12662b48409722d38da99dc677fe59a59f894f6cfa");
  });

  it("jetton transfer wrapping a provide body", () => {
    expect(hash(jt(provide))).toBe("748f82e92ae2ed0237ef3d5f69a8d630fb3968dcb22d8ea4d7340740e7f300aa");
  });

  it("burn body", () => {
    const burn = buildBurnBody({ lpUnits: AMT, responseAddress: USER });
    expect(hash(burn)).toBe("f7a835e2abfa06acebb07dced597a1e7ff7b4e79ae1662db17d7de1e4fbb5ab5");
  });

  it("update_pool_status (unlock) body", () => {
    const upd = buildUpdatePoolStatusBody({ routerWallet0: ROUTER_W, routerWallet1: ASK_WALLET, excessesRecipient: USER });
    expect(hash(upd)).toBe("eb67139075ad4fcdc8600e8d9b3cf07b1088e8daeea5f09134653485c7985542");
  });
});
