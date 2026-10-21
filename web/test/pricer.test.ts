import { describe, expect, it } from "vitest";
import { bpsToPct, feeBps, MAX_FEE_BPS, MIN_FEE_BPS, pctToWad } from "@/lib/pricer";

describe("fuzzy pricer mirror", () => {
  it("safest corner is the minimum fee", () => {
    // high ICR, tiny rescue, healthy system
    expect(feeBps(pctToWad(150), pctToWad(5), pctToWad(200))).toBe(MIN_FEE_BPS); // 100 bps
  });

  it("riskiest corner is the maximum fee", () => {
    // at liquidation, large rescue, Recovery Mode
    expect(feeBps(pctToWad(110), pctToWad(40), pctToWad(150))).toBe(MAX_FEE_BPS); // 1000 bps
  });

  it("matches the deployed table at the Med/Med/Med knot", () => {
    expect(feeBps(pctToWad(125), pctToWad(20), pctToWad(170))).toBe(444n);
  });

  it("is monotonic: a lower ICR costs more", () => {
    const safer = feeBps(pctToWad(150), pctToWad(20), pctToWad(180));
    const riskier = feeBps(pctToWad(120), pctToWad(20), pctToWad(180));
    expect(riskier).toBeGreaterThan(safer);
  });

  it("formats bps as a percent", () => {
    expect(bpsToPct(444n)).toBe("4.44%");
    expect(bpsToPct(100n)).toBe("1.00%");
  });
});
