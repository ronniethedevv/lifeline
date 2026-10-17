import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: { address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false },
  btcAddress: undefined as string | undefined,
  balance: undefined as { value: bigint } | undefined,
  switchChain: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => state.account,
  useBalance: () => ({ data: state.balance }),
  useSwitchChain: () => ({ switchChain: state.switchChain, isPending: false }),
}));
vi.mock("@mezo-org/passport", () => ({ useBitcoinAccount: () => ({ btcAddress: state.btcAddress }) }));

import { AccountPanel } from "@/components/AccountPanel";

const ADDR = "0x32F786F4270457fAe178E22D624D7a57D08B43d3";

beforeEach(() => {
  state.account = { address: undefined, chainId: undefined, isConnected: false };
  state.btcAddress = undefined;
  state.balance = undefined;
  state.switchChain.mockReset();
});
afterEach(cleanup);

describe("AccountPanel", () => {
  it("asks to connect when disconnected", () => {
    render(<AccountPanel />);
    expect(screen.getByText("Connect a wallet")).toBeTruthy();
  });

  it("shows the Mezo account and balance for an EVM wallet", () => {
    state.account = { address: ADDR, chainId: 31611, isConnected: true };
    state.balance = { value: 90_000_000_000_000_000n };
    render(<AccountPanel />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText(ADDR)).toBeTruthy();
    expect(screen.getByText("0.09 BTC")).toBeTruthy();
    expect(screen.queryByText("Bitcoin address")).toBeNull();
  });

  it("shows the Bitcoin address and smart-account note for a BTC wallet", () => {
    state.account = { address: ADDR, chainId: 31611, isConnected: true };
    state.btcAddress = "tb1qexampleaddress0000000000000000000000";
    render(<AccountPanel />);
    expect(screen.getByText("Bitcoin address")).toBeTruthy();
    expect(screen.getByText(state.btcAddress)).toBeTruthy();
    expect(screen.getByText(/Bitcoin wallet via Mezo Passport/)).toBeTruthy();
  });

  it("flags the wrong network in text and offers to switch", () => {
    state.account = { address: ADDR, chainId: 1, isConnected: true };
    render(<AccountPanel />);
    expect(screen.getByText("Wrong network")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Mezo testnet" }));
    expect(state.switchChain).toHaveBeenCalledWith({ chainId: 31611 });
  });
});
