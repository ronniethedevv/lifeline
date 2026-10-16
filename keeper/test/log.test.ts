import { describe, expect, it } from "vitest";
import { createLogger, errorContext, serialize } from "../src/log.js";

describe("log", () => {
  it("serializes bigints as strings in JSON lines", () => {
    const parsed = JSON.parse(serialize("info", "x", { repay: 10n ** 21n })) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: "info", msg: "x", repay: "1000000000000000000000" });
  });

  it("includes error message and cause", () => {
    const err = new Error("outer", { cause: new Error("inner") });
    expect(errorContext(err)).toMatchObject({ error: "outer", cause: "inner" });
    expect(errorContext("plain")).toEqual({ error: "plain" });
  });

  it("writes one line per call", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    log.info("a");
    log.error("b", { k: 1 });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ level: "error", msg: "b", k: 1 });
  });
});
