import { describe, expect, it } from "vitest";
import { makeWagmiConfig, MEZO_TESTNET_CHAIN_ID, WalletConfigError, walletConnectProjectId } from "@/lib/wallet";

describe("wallet config", () => {
  it("targets Mezo testnet only (Passport defaults to mainnet)", () => {
    const config = makeWagmiConfig("test-project-id");
    expect(config.chains.map((c) => c.id)).toEqual([MEZO_TESTNET_CHAIN_ID]);
  });

  it("offers Bitcoin wallets alongside EVM wallets", () => {
    const names = makeWagmiConfig("test-project-id").connectors.map((c) => c.name.toLowerCase());
    expect(names.some((n) => n.includes("unisat"))).toBe(true);
    expect(names.some((n) => n.includes("xverse"))).toBe(true);
    expect(names.some((n) => n.includes("okx"))).toBe(true);
    // Passport wires EVM wallets through WalletConnect only (no named MetaMask connector).
    expect(names.some((n) => n.includes("walletconnect"))).toBe(true);
  });

  it("requires a WalletConnect project ID", () => {
    expect(() => walletConnectProjectId("")).toThrow(WalletConfigError);
    expect(() => walletConnectProjectId(undefined)).toThrow(WalletConfigError);
    expect(walletConnectProjectId("  abc  ")).toBe("abc");
  });
});
