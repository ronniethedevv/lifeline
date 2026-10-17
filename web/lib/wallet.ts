import { getConfig } from "@mezo-org/passport";

/** Mezo testnet (docs/setup.md). Passport's getConfig defaults to MAINNET: always pass "testnet". */
export const MEZO_TESTNET_CHAIN_ID = 31_611;

export class WalletConfigError extends Error {
  override name = "WalletConfigError";
}

/** WalletConnect (Reown) project ID: public, required by Passport's getConfig. */
export function walletConnectProjectId(value = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID): string {
  if (value === undefined || value.trim() === "") {
    throw new WalletConfigError(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set (web/.env.local). Create one at cloud.reown.com.",
    );
  }
  return value.trim();
}

/** wagmi config from Mezo Passport: BTC wallets (Unisat, OKX, Xverse) + EVM wallets, testnet only. */
export function makeWagmiConfig(projectId: string) {
  return getConfig({
    appName: "Lifeline",
    mezoNetwork: "testnet",
    walletConnectProjectId: projectId,
    ssr: true,
  });
}
