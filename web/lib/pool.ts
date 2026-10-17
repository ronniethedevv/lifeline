/**
 * RescueMarket share math, mirrored client-side for previews. Must match the contract exactly:
 * ERC-4626-style with a virtual offset (decision T1.5), all rounding toward the pool (Floor).
 */

export const VIRTUAL_SHARES = 1000n; // RescueMarket.VIRTUAL_SHARES (1e3)
export const VIRTUAL_ASSETS = 1n; // RescueMarket.VIRTUAL_ASSETS

const WAD = 10n ** 18n;

/** Shares a deposit of `assets` mints now (floor). Matches RescueMarket.previewDeposit. */
export function previewDeposit(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);
}

/** MUSD that burning `shares` pays out now (floor). Matches RescueMarket.previewWithdraw. */
export function previewWithdraw(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

/** Smallest share count whose payout covers `assets` (ceil inverse of previewWithdraw). */
export function sharesForAssets(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (assets === 0n) return 0n;
  const num = assets * (totalShares + VIRTUAL_SHARES);
  const den = totalAssets + VIRTUAL_ASSETS;
  return (num + den - 1n) / den; // ceil
}

/** Pool utilisation = outstanding / totalAssets as a 1e18 ratio (0 when the pool is empty). */
export function utilisation(outstanding: bigint, totalAssets: bigint): bigint {
  if (totalAssets === 0n) return 0n;
  return (outstanding * WAD) / totalAssets;
}
