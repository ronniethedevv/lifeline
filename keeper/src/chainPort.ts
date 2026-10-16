import { parseEventLogs, WaitForTransactionReceiptTimeoutError, type Address } from "viem";
import { hintHelpersAbi, rescueMarketAbi, sortedTrovesAbi, vaultFactoryAbi } from "./abis.generated.js";
import type { MezoPublicClient, MezoWalletClient } from "./chain.js";
import type { Config } from "./config.js";
import { RESCUE_STATUS, type KeeperPort, type Quote, type RescueReceipt } from "./keeper.js";

/** Random samples for HintHelpers.getApproxHint (view call: cost is only RPC time). */
const HINT_TRIALS = 50n;
const RECEIPT_TIMEOUT_MS = 120_000;

/** KeeperPort backed by viem. `wallet` is required only for rescue (live mode). */
export function chainPort(cfg: Config, client: MezoPublicClient, wallet?: MezoWalletClient): KeeperPort {
  return {
    async listVaults() {
      return client.readContract({ address: cfg.factoryAddress, abi: vaultFactoryAbi, functionName: "allVaults" });
    },

    async previewRescue(vault: Address): Promise<Quote> {
      const q = await client.readContract({
        address: cfg.marketAddress,
        abi: rescueMarketAbi,
        functionName: "previewRescue",
        args: [vault],
      });
      const status = RESCUE_STATUS[q.status];
      if (status === undefined) throw new Error(`unknown RescueStatus ${q.status} for ${vault}`);
      return { status, icr: q.icr, repay: q.repay, fee: q.fee, tip: q.tip, newNICR: q.newNICR };
    },

    async hints(newNICR: bigint) {
      const seed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      const [approx] = await client.readContract({
        address: cfg.hintHelpersAddress,
        abi: hintHelpersAbi,
        functionName: "getApproxHint",
        args: [newNICR, HINT_TRIALS, seed],
      });
      const [upper, lower] = await client.readContract({
        address: cfg.sortedTrovesAddress,
        abi: sortedTrovesAbi,
        functionName: "findInsertPosition",
        args: [newNICR, approx, approx],
      });
      return { upper, lower };
    },

    async rescue(vault: Address, upper: Address, lower: Address): Promise<RescueReceipt> {
      if (wallet === undefined) throw new Error("rescue needs a wallet (live mode)");
      // Simulate on the node first: it runs Mezo's real oracle, so a revert surfaces here, unsent.
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: cfg.marketAddress,
        abi: rescueMarketAbi,
        functionName: "rescue",
        args: [vault, upper, lower],
      });
      const hash = await wallet.writeContract(request);
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        const [rescued] = parseEventLogs({ abi: rescueMarketAbi, eventName: "Rescued", logs: receipt.logs });
        return {
          hash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          ...(rescued === undefined
            ? {}
            : {
                executed: {
                  repaid: rescued.args.repaid,
                  fee: rescued.args.fee,
                  tip: rescued.args.tip,
                  dueBy: rescued.args.dueBy,
                },
              }),
        };
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return { hash, status: "unknown" };
        throw err;
      }
    },
  };
}
