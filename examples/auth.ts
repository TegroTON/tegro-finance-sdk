// Open a staking session with TON Connect, then call an authenticated endpoint.
//
// The read part (getPayload) runs anywhere: `npx tsx examples/auth.ts`.
// The full flow needs a wallet, so the signing parts are shown as a recipe.

import {
  TegroFinanceAuthClient,
  TegroFinanceStakingClient,
  tonProofToLoginRequest,
} from "../src/index.js";

const auth = new TegroFinanceAuthClient();

// 1. Get a challenge payload (open, no wallet).
const payload = await auth.getPayload();
console.log("auth payload:", payload);

// 2. Hand the payload to your TON Connect UI BEFORE the user connects, so the
//    wallet signs a ton_proof over it:
//
//      tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: payload } });
//
//    After the user connects, map the wallet's signed proof and log in:
//
//      const req = tonProofToLoginRequest(wallet, { affiliateAddress, tgInitData });
//      const { token } = await auth.login(req);   // 48h session; cookie also set in-browser
//
// 3a. BROWSER, same-origin as tegro.finance: the session cookie is now set —
//     just use the staking client, the cookie travels automatically:
//
//      const staking = new TegroFinanceStakingClient();
//      await staking.buildStake({ masterAddress, offerAmount });
//
// 3b. SERVER-side (or a Mini App on your own domain that proxies through its
//     backend): pass the returned token explicitly —
//
//      const staking = new TegroFinanceStakingClient({ sessionToken: token });
//      await staking.getWithdrawals(masterAddress);
//
//    (The SDK sends it as the `tegro-dex` cookie. A browser cannot set that
//    header cross-origin, so on a different domain do this from your server.)

void tonProofToLoginRequest;
void TegroFinanceStakingClient;
