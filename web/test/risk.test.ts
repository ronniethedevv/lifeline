import { describe, expect, it } from "vitest";
import {
  classifyRisk,
  currentICR,
  liquidationPrice,
  minBorrowForFullRescue,
  nominalICR,
  rescueRoom,
  validateTerms,
} from "@/lib/risk";

const pct = (n: number) => BigInt(Math.round(n * 10)) * 10n ** 15n; // n% -> 1e18 ratio (1 dp)
const musd = (n: number) => BigInt(n) * 10n ** 18n;

describe("classifyRisk", () => {
  const base = { hasTrove: true, lienActive: false, optedIn: true, icr: pct(200), triggerICR: pct(130) };

  it("reports no-trove and lien ahead of everything else", () => {
    expect(classifyRisk({ ...base, hasTrove: false })).toBe("no-trove");
    expect(classifyRisk({ ...base, lienActive: true })).toBe("lien");
    expect(classifyRisk({ ...base, hasTrove: false, lienActive: true })).toBe("no-trove");
  });

  it("is unprotected without opt-in or terms", () => {
    expect(classifyRisk({ ...base, optedIn: false })).toBe("unprotected");
    expect(classifyRisk({ ...base, triggerICR: 0n })).toBe("unprotected");
  });

  it("grades safe / watch / danger around the trigger and 20pp band", () => {
    expect(classifyRisk({ ...base, icr: pct(150) })).toBe("safe"); // trigger 130 + 20
    expect(classifyRisk({ ...base, icr: pct(149.9) })).toBe("watch");
    expect(classifyRisk({ ...base, icr: pct(130) })).toBe("watch");
    expect(classifyRisk({ ...base, icr: pct(129.9) })).toBe("danger");
  });
});

describe("ratio math", () => {
  it("currentICR = coll * price / debt", () => {
    expect(currentICR(10n ** 18n, musd(1000), musd(2000))).toBe(pct(200));
    expect(currentICR(10n ** 18n, 0n, musd(2000))).toBe(0n);
  });

  it("nominalICR uses the 1e20 scale", () => {
    expect(nominalICR(10n ** 18n, musd(1000))).toBe((10n ** 18n * 10n ** 20n) / musd(1000));
    expect(nominalICR(0n, 0n)).toBe(0n);
  });

  it("liquidationPrice solves ICR = MCR", () => {
    expect(liquidationPrice(10n ** 18n, musd(1000), pct(110))).toBe(musd(1100));
    expect(liquidationPrice(0n, musd(1000), pct(110))).toBe(0n);
  });
});

describe("rescueRoom (mirrors RescueMarket's min-net-debt cap)", () => {
  const base = { gasComp: musd(200), minNetDebt: musd(1800), triggerICR: pct(130), targetICR: pct(150) };

  it("has no room at the minimum debt", () => {
    const r = rescueRoom({ ...base, debt: musd(2000) }); // net 1,800
    expect(r.room).toBe(0n);
    expect(r.level).toBe("none");
  });

  it("is partial when the room is below what a trigger-time rescue needs", () => {
    const r = rescueRoom({ ...base, debt: musd(2200) }); // net 2,000 -> room 200
    expect(r.room).toBe(musd(200));
    expect(r.needed).toBe(musd(2200) - (musd(2200) * pct(130)) / pct(150)); // ~293.3
    expect(r.level).toBe("partial");
  });

  it("is full for a loan well above the minimum", () => {
    const r = rescueRoom({ ...base, debt: musd(4500) }); // room 2,500, needs 600
    expect(r.room).toBe(musd(2500));
    expect(r.level).toBe("full");
  });

  it("minBorrowForFullRescue is the exact full/partial boundary", () => {
    const n = minBorrowForFullRescue(base.minNetDebt, base.gasComp, base.triggerICR, base.targetICR); // ~2,107.69
    expect(rescueRoom({ ...base, debt: n + base.gasComp }).level).toBe("full");
    expect(rescueRoom({ ...base, debt: n - 10n ** 15n + base.gasComp }).level).toBe("partial");
  });
});

describe("validateTerms", () => {
  const mcr = pct(110);
  it("accepts MCR < trigger < target with positive maxRescue", () => {
    expect(validateTerms({ mcr, triggerICR: pct(130), targetICR: pct(150), maxRescue: musd(500) })).toBeNull();
  });
  it("rejects trigger at/below MCR, target at/below trigger, and zero maxRescue", () => {
    expect(validateTerms({ mcr, triggerICR: pct(110), targetICR: pct(150), maxRescue: musd(500) })).toMatch(/liquidation ratio/);
    // Contract rule (PositionVault.MIN_TRIGGER_BUFFER): within 20 points of MCR is rejected, MCR + 20 is the floor.
    expect(validateTerms({ mcr, triggerICR: pct(129), targetICR: pct(150), maxRescue: musd(500) })).toMatch(/20 points/);
    expect(validateTerms({ mcr, triggerICR: pct(130), targetICR: pct(130), maxRescue: musd(500) })).toMatch(/above the trigger/);
    expect(validateTerms({ mcr, triggerICR: pct(130), targetICR: pct(150), maxRescue: 0n })).toMatch(/greater than zero/);
  });
});
