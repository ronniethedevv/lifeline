import { readFileSync } from "node:fs";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Config {
  rpcUrl: string;
  marketAddress: Address;
  factoryAddress: Address;
  hintHelpersAddress: Address;
  sortedTrovesAddress: Address;
  /** Only present (and required) in live mode. */
  keeperKey: Hex | undefined;
  live: boolean;
  pollIntervalMs: number;
  /** Max concurrent previewRescue reads per poll. */
  readConcurrency: number;
  /** Stop after this long (ms); undefined = run until SIGINT/SIGTERM. */
  runForMs: number | undefined;
}

const DEFAULT_RPC = "https://rpc.test.mezo.org";
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_READ_CONCURRENCY = 4;

interface Deployments {
  chainId: number;
  musd: Record<string, { address: string } | undefined>;
  lifeline?: Record<string, { address?: string } | undefined>;
}

function address(value: string | undefined, label: string): Address {
  if (value === undefined || !isAddress(value, { strict: false })) {
    throw new ConfigError(`${label}: missing or invalid address (${String(value)})`);
  }
  return getAddress(value);
}

function privateKey(value: string | undefined): Hex {
  const key = value?.trim() ?? "";
  const prefixed = key.startsWith("0x") ? key : `0x${key}`;
  if (!isHex(prefixed) || prefixed.length !== 66) {
    throw new ConfigError("KEEPER_PRIVATE_KEY: missing or not a 32-byte hex key (required with --live)");
  }
  return prefixed;
}

function positiveInt(value: string | undefined, fallback: number, label: string, min = 1): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${label}: expected an integer >= ${min}, got ${value}`);
  return n;
}

/**
 * Builds the keeper config from env + CLI args + deployments/testnet.json (single source of
 * truth for addresses; MARKET_ADDRESS / FACTORY_ADDRESS env vars override).
 */
export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[], deploymentsPath: string): Config {
  let deployments: Deployments;
  try {
    deployments = JSON.parse(readFileSync(deploymentsPath, "utf8")) as Deployments;
  } catch (err) {
    throw new ConfigError(`cannot read deployments file ${deploymentsPath}`, { cause: err });
  }
  const live = argv.includes("--live");
  return {
    rpcUrl: env.MEZO_TESTNET_RPC ?? DEFAULT_RPC,
    marketAddress: address(env.MARKET_ADDRESS ?? deployments.lifeline?.RescueMarket?.address, "RescueMarket"),
    factoryAddress: address(env.FACTORY_ADDRESS ?? deployments.lifeline?.VaultFactory?.address, "VaultFactory"),
    hintHelpersAddress: address(deployments.musd.HintHelpers?.address, "HintHelpers"),
    sortedTrovesAddress: address(deployments.musd.SortedTroves?.address, "SortedTroves"),
    keeperKey: live ? privateKey(env.KEEPER_PRIVATE_KEY) : undefined,
    live,
    pollIntervalMs: positiveInt(env.POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, "POLL_INTERVAL_MS", MIN_POLL_INTERVAL_MS),
    readConcurrency: positiveInt(env.READ_CONCURRENCY, DEFAULT_READ_CONCURRENCY, "READ_CONCURRENCY"),
    runForMs: runFor(argv),
  };
}

/** `--run-for=<seconds>`: stop after this long (scheduled CI runs). Absent = run until stopped. */
function runFor(argv: readonly string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith("--run-for="));
  if (arg === undefined) return undefined;
  return positiveInt(arg.slice("--run-for=".length), 0, "--run-for") * 1000;
}
