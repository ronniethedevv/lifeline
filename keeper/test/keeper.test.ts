import type { Address, Hash } from "viem";
import { describe, expect, it } from "vitest";
import { runOnce, summarize, type KeeperPort, type Quote, type RescueStatus } from "../src/keeper.js";
import type { Logger } from "../src/log.js";

const A = "0x00000000000000000000000000000000000000aA" as Address;
const B = "0x00000000000000000000000000000000000000bB" as Address;
const C = "0x00000000000000000000000000000000000000cC" as Address;
const UPPER = "0x0000000000000000000000000000000000000001" as Address;
const LOWER = "0x0000000000000000000000000000000000000002" as Address;
const HASH = ("0x" + "ab".repeat(32)) as Hash;

function quote(status: RescueStatus, newNICR = 123n): Quote {
  return { status, icr: 14n * 10n ** 17n, repay: 900n * 10n ** 18n, fee: 30n * 10n ** 18n, tip: 9n * 10n ** 17n, newNICR };
}

interface Calls {
  hints: bigint[];
  rescues: { vault: Address; upper: Address; lower: Address }[];
  maxConcurrentRescues: number;
}

function fakePort(quotes: Record<Address, Quote | Error>, overrides: Partial<KeeperPort> = {}): KeeperPort & {
  calls: Calls;
} {
  const calls: Calls = { hints: [], rescues: [], maxConcurrentRescues: 0 };
  let inFlight = 0;
  return {
    calls,
    listVaults: () => Promise.resolve(Object.keys(quotes) as Address[]),
    previewRescue: (vault) => {
      const q = quotes[vault];
      return q instanceof Error ? Promise.reject(q) : Promise.resolve(q as Quote);
    },
    hints: (nicr) => {
      calls.hints.push(nicr);
      return Promise.resolve({ upper: UPPER, lower: LOWER });
    },
    rescue: async (vault, upper, lower) => {
      inFlight++;
      calls.maxConcurrentRescues = Math.max(calls.maxConcurrentRescues, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      calls.rescues.push({ vault, upper, lower });
      inFlight--;
      return { hash: HASH, status: "success", blockNumber: 1n };
    },
    ...overrides,
  };
}

function captureLog(): Logger & { lines: { level: string; msg: string; ctx: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; ctx: Record<string, unknown> }[] = [];
  const push = (level: string) => (msg: string, ctx: Record<string, unknown> = {}) => {
    lines.push({ level, msg, ctx });
  };
  return { lines, info: push("info"), warn: push("warn"), error: push("error") };
}

const LIVE = { live: true, readConcurrency: 4 };
const DRY = { live: false, readConcurrency: 4 };

describe("runOnce", () => {
  it("skips every non-Ok status without sending", async () => {
    const statuses: RescueStatus[] = ["NotVault", "NotOptedIn", "LienActive", "AboveTrigger", "NothingToRescue"];
    const quotes = Object.fromEntries(
      statuses.map((s, i) => [`0x${(i + 1).toString(16).padStart(40, "0")}`, quote(s)]),
    );
    const port = fakePort(quotes);
    const out = await runOnce(port, LIVE, captureLog());
    expect(out.map((o) => o.action)).toEqual(Array(5).fill("skipped"));
    expect(port.calls.rescues).toHaveLength(0);
  });

  it("dry run reports would-rescue and sends nothing", async () => {
    const port = fakePort({ [A]: quote("Ok"), [B]: quote("AboveTrigger") });
    const log = captureLog();
    const out = await runOnce(port, DRY, log);
    expect(out[0]).toMatchObject({ vault: A, action: "would-rescue" });
    expect(out[1]).toMatchObject({ vault: B, action: "skipped", status: "AboveTrigger" });
    expect(port.calls.rescues).toHaveLength(0);
    expect(port.calls.hints).toHaveLength(0);
    expect(log.lines.some((l) => l.msg === "would rescue (dry run)")).toBe(true);
  });

  it("live: computes hints from the quote's newNICR and rescues with them", async () => {
    const port = fakePort({ [A]: quote("Ok", 777n) });
    const out = await runOnce(port, LIVE, captureLog());
    expect(port.calls.hints).toEqual([777n]);
    expect(port.calls.rescues).toEqual([{ vault: A, upper: UPPER, lower: LOWER }]);
    expect(out[0]).toMatchObject({ action: "rescued", receipt: { hash: HASH, status: "success" } });
  });

  it("live: sends rescues one at a time", async () => {
    const port = fakePort({ [A]: quote("Ok"), [B]: quote("Ok"), [C]: quote("Ok") });
    await runOnce(port, LIVE, captureLog());
    expect(port.calls.rescues.map((r) => r.vault)).toEqual([A, B, C]);
    expect(port.calls.maxConcurrentRescues).toBe(1);
  });

  it("a preview failure on one vault is logged and the others still run", async () => {
    const port = fakePort({ [A]: new Error("rpc dropped"), [B]: quote("Ok") });
    const log = captureLog();
    const out = await runOnce(port, LIVE, log);
    expect(out[0]).toMatchObject({ vault: A, action: "failed", stage: "preview", error: "rpc dropped" });
    expect(out[1]).toMatchObject({ vault: B, action: "rescued" });
    expect(log.lines.find((l) => l.level === "error")?.ctx).toMatchObject({ vault: A, error: "rpc dropped" });
  });

  it("a failed simulation/send is logged, not retried, and the pass continues", async () => {
    let attempts = 0;
    const base = fakePort({ [A]: quote("Ok"), [B]: quote("Ok") });
    const port: KeeperPort = {
      ...base,
      rescue: (vault, upper, lower) => {
        attempts++;
        return vault === A ? Promise.reject(new Error("execution reverted: LienActive()")) : base.rescue(vault, upper, lower);
      },
    };
    const log = captureLog();
    const out = await runOnce(port, LIVE, log);
    expect(out[0]).toMatchObject({ vault: A, action: "failed", stage: "rescue" });
    expect(out[1]).toMatchObject({ vault: B, action: "rescued" });
    expect(attempts).toBe(2); // one attempt each: no retry of A
  });

  it("a hint failure skips the send", async () => {
    const port = fakePort({ [A]: quote("Ok") }, { hints: () => Promise.reject(new Error("hint rpc error")) });
    const out = await runOnce(port, LIVE, captureLog());
    expect(out[0]).toMatchObject({ action: "failed", stage: "hints" });
    expect(port.calls.rescues).toHaveLength(0);
  });

  it("an unknown-outcome send is reported as a warning (re-checked next poll, never re-sent)", async () => {
    const port = fakePort({ [A]: quote("Ok") }, { rescue: () => Promise.resolve({ hash: HASH, status: "unknown" }) });
    const log = captureLog();
    const out = await runOnce(port, LIVE, log);
    expect(out[0]).toMatchObject({ action: "rescued", receipt: { status: "unknown" } });
    expect(log.lines.find((l) => l.msg === "rescue sent")?.level).toBe("warn");
  });

  it("propagates a listVaults failure to the caller", async () => {
    const port = fakePort({}, { listVaults: () => Promise.reject(new Error("factory read failed")) });
    await expect(runOnce(port, LIVE, captureLog())).rejects.toThrow("factory read failed");
  });

  it("logs a per-poll summary by action and skip reason", async () => {
    const port = fakePort({ [A]: quote("Ok"), [B]: quote("AboveTrigger"), [C]: quote("NotOptedIn") });
    const log = captureLog();
    const out = await runOnce(port, LIVE, log);
    expect(summarize(out)).toEqual({ rescued: 1, skipped: 2, AboveTrigger: 1, NotOptedIn: 1 });
    expect(log.lines.find((l) => l.msg === "poll done")?.ctx).toEqual(summarize(out));
  });

  it("handles an empty factory", async () => {
    expect(await runOnce(fakePort({}), LIVE, captureLog())).toEqual([]);
  });
});
