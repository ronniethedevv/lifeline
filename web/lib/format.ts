import { formatUnits } from "viem";

/** BTC to at most 8 decimals (ui_context.md), trailing zeros trimmed, rounded down. */
export function formatBtc(wei: bigint): string {
  const sats = wei / 10n ** 10n; // 18 -> 8 decimals, floor
  return formatUnits(sats, 8);
}

/** MUSD to 2 decimals, rounded down. */
export function formatMusd(wei: bigint): string {
  const cents = wei / 10n ** 16n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
