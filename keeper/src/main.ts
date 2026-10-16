import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { makePublicClient, makeWalletClient } from "./chain.js";
import { chainPort } from "./chainPort.js";
import { loadConfig } from "./config.js";
import { runOnce } from "./keeper.js";
import { createLogger, errorContext } from "./log.js";

const DEPLOYMENTS = fileURLToPath(new URL("../../deployments/testnet.json", import.meta.url));

async function main(): Promise<void> {
  const log = createLogger();
  const cfg = loadConfig(process.env, process.argv, DEPLOYMENTS);
  const client = makePublicClient(cfg.rpcUrl);
  const wallet = cfg.keeperKey === undefined ? undefined : makeWalletClient(cfg.rpcUrl, cfg.keeperKey);

  const chainId = await client.getChainId();
  if (chainId !== client.chain.id) throw new Error(`RPC chain id ${chainId} != Mezo testnet ${client.chain.id}`);

  log.info("keeper starting", {
    mode: cfg.live ? "live" : "dry-run",
    keeper: wallet?.account.address,
    market: cfg.marketAddress,
    factory: cfg.factoryAddress,
    pollIntervalMs: cfg.pollIntervalMs,
  });

  const stop = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      log.info("stopping", { signal: sig });
      stop.abort();
    });
  }

  const port = chainPort(cfg, client, wallet);
  while (!stop.signal.aborted) {
    try {
      await runOnce(port, { live: cfg.live, readConcurrency: cfg.readConcurrency }, log);
    } catch (err) {
      log.error("poll failed", errorContext(err));
    }
    try {
      await sleep(cfg.pollIntervalMs, undefined, { signal: stop.signal });
    } catch {
      // aborted by SIGINT/SIGTERM: loop condition exits
    }
  }
}

main().catch((err: unknown) => {
  createLogger().error("keeper crashed", errorContext(err));
  process.exitCode = 1;
});
