import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const MARKET = "0x73ee6C5334C8E32F0509380461b3157e47aCa184";
const FACTORY = "0x5D370d6b5B641110c687ab599D5C3ED0FdF832dd";
const KEY = "0x" + "11".repeat(32);

function deploymentsFile(lifeline: unknown = { RescueMarket: { address: MARKET }, VaultFactory: { address: FACTORY } }) {
  const dir = mkdtempSync(join(tmpdir(), "keeper-cfg-"));
  const path = join(dir, "testnet.json");
  writeFileSync(
    path,
    JSON.stringify({
      chainId: 31611,
      musd: {
        HintHelpers: { address: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6" },
        SortedTroves: { address: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA" },
      },
      lifeline,
    }),
  );
  return path;
}

describe("loadConfig", () => {
  it("reads addresses from deployments and defaults to dry run", () => {
    const cfg = loadConfig({}, [], deploymentsFile());
    expect(cfg.marketAddress).toBe(MARKET);
    expect(cfg.factoryAddress).toBe(FACTORY);
    expect(cfg.live).toBe(false);
    expect(cfg.keeperKey).toBeUndefined();
    expect(cfg.rpcUrl).toBe("https://rpc.test.mezo.org");
    expect(cfg.pollIntervalMs).toBe(30_000);
  });

  it("does not require a key in dry run even if one is set", () => {
    const cfg = loadConfig({ KEEPER_PRIVATE_KEY: KEY }, [], deploymentsFile());
    expect(cfg.keeperKey).toBeUndefined();
  });

  it("live mode requires a valid key", () => {
    expect(() => loadConfig({}, ["--live"], deploymentsFile())).toThrow(ConfigError);
    expect(() => loadConfig({ KEEPER_PRIVATE_KEY: "0x1234" }, ["--live"], deploymentsFile())).toThrow(ConfigError);
    expect(() => loadConfig({ KEEPER_PRIVATE_KEY: "zz".repeat(32) }, ["--live"], deploymentsFile())).toThrow(
      ConfigError,
    );
  });

  it("accepts a key with or without 0x in live mode", () => {
    expect(loadConfig({ KEEPER_PRIVATE_KEY: KEY }, ["--live"], deploymentsFile()).keeperKey).toBe(KEY);
    expect(loadConfig({ KEEPER_PRIVATE_KEY: KEY.slice(2) }, ["--live"], deploymentsFile()).keeperKey).toBe(KEY);
  });

  it("env overrides deployment addresses", () => {
    const other = "0x0000000000000000000000000000000000000abc";
    const cfg = loadConfig({ MARKET_ADDRESS: other }, [], deploymentsFile());
    expect(cfg.marketAddress).toBe(getAddress(other));
  });

  it("rejects missing or invalid addresses", () => {
    expect(() => loadConfig({}, [], deploymentsFile({}))).toThrow(/RescueMarket/);
    expect(() => loadConfig({ FACTORY_ADDRESS: "0x123" }, [], deploymentsFile())).toThrow(/VaultFactory/);
  });

  it("validates poll interval", () => {
    expect(loadConfig({ POLL_INTERVAL_MS: "5000" }, [], deploymentsFile()).pollIntervalMs).toBe(5000);
    expect(() => loadConfig({ POLL_INTERVAL_MS: "10" }, [], deploymentsFile())).toThrow(ConfigError);
    expect(() => loadConfig({ POLL_INTERVAL_MS: "abc" }, [], deploymentsFile())).toThrow(ConfigError);
  });

  it("reports an unreadable deployments file", () => {
    expect(() => loadConfig({}, [], "/nonexistent/testnet.json")).toThrow(/cannot read deployments/);
  });
});
