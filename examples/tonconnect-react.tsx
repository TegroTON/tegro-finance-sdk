// Frontend swap with TON Connect + React. The wallet signs; the SDK builds.
//
// Requires (in your app, not in this SDK):
//   npm i @tonconnect/ui-react @tegroton/tegro-finance
//
// This file is illustrative — it is not compiled by the SDK's tsconfig.

import { useState } from "react";
import { TonConnectUIProvider, useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import {
  TegroFinanceClient,
  toUnits,
  applySlippage,
  toTonConnectMessages,
  TON_NATIVE_ADDRESS,
} from "@tegroton/tegro-finance";

const client = new TegroFinanceClient();

function SwapButton({ tgrAddress }: { tgrAddress: string }) {
  const [tonConnectUI] = useTonConnectUI();
  const userAddress = useTonAddress(); // bounceable EQ.../UQ...
  const [status, setStatus] = useState("");

  async function swapOneTon() {
    if (!userAddress) {
      setStatus("Connect a wallet first");
      return;
    }
    const offerUnits = toUnits("1", 9); // 1 TON
    const slippage = 0.01;

    const quote = await client.simulateSwap({
      offerAddress: TON_NATIVE_ADDRESS,
      askAddress: tgrAddress,
      units: offerUnits,
      slippageTolerance: slippage,
    });

    const tx = await client.buildSwap({
      userWalletAddress: userAddress,
      offerJettonAddress: TON_NATIVE_ADDRESS,
      offerAmount: offerUnits,
      askJettonAddress: tgrAddress,
      minAskAmount: applySlippage(quote.ask_units, slippage),
    });

    // Hand the prepared messages to the wallet. This is the only place a
    // signature happens — the SDK never sees a key.
    await tonConnectUI.sendTransaction(toTonConnectMessages(tx));
    setStatus("Submitted — confirm in your wallet");
  }

  return (
    <div>
      <button onClick={swapOneTon}>Swap 1 TON → TGR</button>
      <p>{status}</p>
    </div>
  );
}

export function App() {
  return (
    <TonConnectUIProvider manifestUrl="https://your-app.example/tonconnect-manifest.json">
      <SwapButton tgrAddress="EQBaAMBEi5TUgPUqmEtPZ4pDO4dgItw9h2N6UuFQwugzG0Ul" />
    </TonConnectUIProvider>
  );
}
