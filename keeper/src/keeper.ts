import { zeroAddress, type Address, type Hash } from "viem";
import { errorContext, type Logger } from "./log.js";

/** Mirrors RescueMarket.RescueStatus. */
export const RESCUE_STATUS = ["Ok", "NotVault", "NotOptedIn", "LienActive", "AboveTrigger", "NothingToRescue"] as const;
export type RescueStatus = (typeof RESCUE_STATUS)[number];

export interface Quote {
  status: RescueStatus;
  icr: bigint;
  repay: bigint;
  fee: bigint;
  tip: bigint;
  newNICR: bigint;
}

/** Amounts actually executed, from the Rescued event (they can differ slightly from the
 *  preview: interest accrues between the preview and the block the rescue lands in). */
export interface Executed {
  repaid: bigint;
  fee: bigint;
  tip: bigint;
  dueBy: bigint;
}

export interface RescueReceipt {
  hash: Hash;
  /** `unknown`: sent but no receipt yet (timeout). Never re-sent: next poll re-checks previewRescue. */
  status: "success" | "reverted" | "unknown";
  blockNumber?: bigint;
  executed?: Executed;
}

/** A vault's rescue lien (PositionVault.lien). */
export interface Lien {
  amount: bigint;
  dueBy: bigint;
  active: boolean;
}

/** Receipt of a claimLien send (seizure of an overdue lien). */
export interface ClaimReceipt {
  hash: Hash;
  status: "success" | "reverted" | "unknown";
  blockNumber?: bigint;
}

/** What the keeper needs from the chain. The viem implementation is in chainPort.ts. */
export interface KeeperPort {
  listVaults(): Promise<readonly Address[]>;
  previewRescue(vault: Address): Promise<Quote>;
  hints(newNICR: bigint): Promise<{ upper: Address; lower: Address }>;
  /** Simulates on the node, sends, and waits for the receipt. */
  rescue(vault: Address, upper: Address, lower: Address): Promise<RescueReceipt>;
  /** Latest block timestamp, compared against lien deadlines. */
  now(): Promise<bigint>;
  /** A vault's current lien. */
  lien(vault: Address): Promise<Lien>;
  /** Simulates on the node, sends, and waits for the receipt (seizure of an overdue lien). */
  claimLien(vault: Address, upper: Address, lower: Address): Promise<ClaimReceipt>;
}

export type VaultOutcome =
  | { vault: Address; action: "skipped"; status: RescueStatus }
  | { vault: Address; action: "would-rescue"; quote: Quote }
  | { vault: Address; action: "rescued"; quote: Quote; receipt: RescueReceipt }
  | { vault: Address; action: "would-claim"; lien: Lien }
  | { vault: Address; action: "claimed"; lien: Lien; receipt: ClaimReceipt }
  | { vault: Address; action: "failed"; stage: "preview" | "hints" | "rescue" | "claim"; error: string };

export interface RunOptions {
  live: boolean;
  readConcurrency: number;
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * One keeper pass: preview every vault (reads in parallel), then rescue the rescuable ones one at
 * a time (one sender, no nonce races). A failure on one vault is logged with context and the pass
 * continues; listing vaults failing aborts the pass (the caller logs it).
 */
export async function runOnce(port: KeeperPort, opts: RunOptions, log: Logger): Promise<VaultOutcome[]> {
  const vaults = await port.listVaults();
  log.info("poll", { vaults: vaults.length, live: opts.live });

  const previews = await mapWithConcurrency(vaults, opts.readConcurrency, async (vault) => {
    try {
      return { ok: true as const, vault, quote: await port.previewRescue(vault) };
    } catch (err) {
      log.error("previewRescue failed", { vault, ...errorContext(err) });
      return { ok: false as const, vault, error: errorContext(err).error as string };
    }
  });

  const now = await port.now();
  const outcomes: VaultOutcome[] = [];
  for (const p of previews) {
    if (!p.ok) {
      outcomes.push({ vault: p.vault, action: "failed", stage: "preview", error: p.error });
      continue;
    }
    const { vault, quote } = p;
    if (quote.status === "Ok") {
      if (!opts.live) {
        log.info("would rescue (dry run)", { vault, ...quote });
        outcomes.push({ vault, action: "would-rescue", quote });
      } else {
        outcomes.push(await rescueOne(port, vault, quote, log));
      }
    } else if (quote.status === "LienActive") {
      outcomes.push(await claimIfDue(port, vault, now, opts.live, log));
    } else {
      outcomes.push({ vault, action: "skipped", status: quote.status });
    }
  }
  log.info("poll done", summarize(outcomes));
  return outcomes;
}

/** Claims a vault's lien when it is active and past its deadline; otherwise skips it. */
async function claimIfDue(
  port: KeeperPort,
  vault: Address,
  now: bigint,
  live: boolean,
  log: Logger,
): Promise<VaultOutcome> {
  let lien: Lien;
  try {
    lien = await port.lien(vault);
  } catch (err) {
    log.error("lien read failed", { vault, ...errorContext(err) });
    return { vault, action: "failed", stage: "claim", error: errorContext(err).error as string };
  }
  if (!lien.active || lien.dueBy > now) return { vault, action: "skipped", status: "LienActive" };
  if (!live) {
    log.info("would claim (dry run)", { vault, dueBy: lien.dueBy, amount: lien.amount });
    return { vault, action: "would-claim", lien };
  }
  return claimOne(port, vault, lien, log);
}

async function claimOne(port: KeeperPort, vault: Address, lien: Lien, log: Logger): Promise<VaultOutcome> {
  try {
    // Zero hints: MUSD re-searches the insert position after the seizure (gas only, always valid).
    const receipt = await port.claimLien(vault, zeroAddress, zeroAddress);
    const level = receipt.status === "success" ? "info" : "warn";
    log[level]("claim sent", { vault, txHash: receipt.hash, txStatus: receipt.status, block: receipt.blockNumber, lien });
    return { vault, action: "claimed", lien, receipt };
  } catch (err) {
    log.error("claim failed", { vault, ...errorContext(err) });
    return { vault, action: "failed", stage: "claim", error: errorContext(err).error as string };
  }
}

/** Counts per action, and per status for skipped vaults, e.g. { rescued: 1, skipped: 3, AboveTrigger: 2, NotOptedIn: 1 }. */
export function summarize(outcomes: readonly VaultOutcome[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of outcomes) {
    counts[o.action] = (counts[o.action] ?? 0) + 1;
    if (o.action === "skipped") counts[o.status] = (counts[o.status] ?? 0) + 1;
  }
  return counts;
}

async function rescueOne(port: KeeperPort, vault: Address, quote: Quote, log: Logger): Promise<VaultOutcome> {
  let hints: { upper: Address; lower: Address };
  try {
    hints = await port.hints(quote.newNICR);
  } catch (err) {
    log.error("hint computation failed", { vault, ...errorContext(err) });
    return { vault, action: "failed", stage: "hints", error: errorContext(err).error as string };
  }
  try {
    const receipt = await port.rescue(vault, hints.upper, hints.lower);
    const level = receipt.status === "success" ? "info" : "warn";
    log[level]("rescue sent", {
      vault,
      txHash: receipt.hash,
      txStatus: receipt.status,
      block: receipt.blockNumber,
      quoted: quote,
      executed: receipt.executed,
    });
    return { vault, action: "rescued", quote, receipt };
  } catch (err) {
    log.error("rescue failed", { vault, ...errorContext(err) });
    return { vault, action: "failed", stage: "rescue", error: errorContext(err).error as string };
  }
}
