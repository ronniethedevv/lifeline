"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { mezoTestnet } from "@mezo-org/passport";
import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { makeWagmiConfig, walletConnectProjectId } from "@/lib/wallet";

/** wagmi + React Query + RainbowKit, configured by Mezo Passport for Mezo testnet. */
export function Providers({ children }: { children: ReactNode }) {
  const [config] = useState(() => makeWagmiConfig(walletConnectProjectId()));
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={mezoTestnet}
          theme={darkTheme({ accentColor: "#f7931a", accentColorForeground: "#0b0d10", borderRadius: "medium" })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
