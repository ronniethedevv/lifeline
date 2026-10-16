import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateE2e, generateKeeper } from "../scripts/gen-abis.js";

describe("generated ABIs", () => {
  it("match contracts/out (run `pnpm gen:abis` after `forge build`)", () => {
    const keeper = readFileSync(fileURLToPath(new URL("../src/abis.generated.ts", import.meta.url)), "utf8");
    const e2e = readFileSync(fileURLToPath(new URL("./e2e/artifacts.generated.ts", import.meta.url)), "utf8");
    expect(keeper).toBe(generateKeeper());
    expect(e2e).toBe(generateE2e());
  });
});
