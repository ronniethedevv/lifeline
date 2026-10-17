import { describe, expect, it } from "vitest";
import { previewDeposit, previewWithdraw, sharesForAssets, utilisation } from "@/lib/pool";

const musd = (n: number) => BigInt(n) * 10n ** 18n;

describe("share math (mirrors RescueMarket, virtual offset 1e3 / 1, floor)", () => {
  it("first deposit mints assets * (0 + 1000) / (0 + 1)", () => {
    expect(previewDeposit(musd(1000), 0n, 0n)).toBe(musd(1000) * 1000n);
  });

  it("previewWithdraw is the floor inverse at steady state", () => {
    const totalAssets = musd(1000);
    const totalShares = musd(1000) * 1000n; // as if one provider deposited 1000
    // Withdrawing all shares returns ~all assets (floor loses at most dust).
    expect(previewWithdraw(totalShares, totalAssets, totalShares)).toBeLessThanOrEqual(totalAssets);
    expect(previewWithdraw(totalShares, totalAssets, totalShares)).toBeGreaterThan(totalAssets - musd(1));
  });

  it("sharesForAssets burns enough shares to cover the requested MUSD", () => {
    const totalAssets = musd(1000);
    const totalShares = musd(1000) * 1000n;
    const want = musd(250);
    const shares = sharesForAssets(want, totalAssets, totalShares);
    expect(previewWithdraw(shares, totalAssets, totalShares)).toBeGreaterThanOrEqual(want);
    expect(sharesForAssets(0n, totalAssets, totalShares)).toBe(0n);
  });
});

describe("utilisation", () => {
  it("is outstanding / totalAssets as a 1e18 ratio, 0 when empty", () => {
    expect(utilisation(musd(300), musd(1000))).toBe(3n * 10n ** 17n); // 0.3e18 = 30%
    expect(utilisation(0n, 0n)).toBe(0n);
    expect(utilisation(musd(1000), musd(1000))).toBe(10n ** 18n); // 100%
  });
});
