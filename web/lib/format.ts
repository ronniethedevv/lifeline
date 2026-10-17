import { formatUnits, parseEther, parseUnits } from "viem";

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

/** A ratio (1e18 = 100%) to a percentage string with `decimals` places, e.g. 1.5e18 -> "150.0%". */
export function formatPercent(ratio: bigint, decimals = 1): string {
  return `${Number(formatUnits(ratio, 16)).toFixed(decimals)}%`;
}

export class ParseError extends Error {
  override name = "ParseError";
}

function requirePositive(raw: string): string {
  const s = raw.trim();
  if (s === "" || !/^\d*\.?\d*$/.test(s) || Number(s) <= 0) throw new ParseError(`Enter a positive number: "${raw}"`);
  return s;
}

/** Parse a BTC amount ("0.05") to wei (1e18). Throws ParseError on non-positive or malformed input. */
export function parseBtc(raw: string): bigint {
  return parseEther(requirePositive(raw));
}

/** Parse an MUSD amount ("1800") to 1e18. Throws ParseError on non-positive or malformed input. */
export function parseMusd(raw: string): bigint {
  return parseUnits(requirePositive(raw), 18);
}

/** Parse a percentage ("150", "150.5") to a 1e18 ratio (150 -> 1.5e18). Throws ParseError. */
export function parsePercent(raw: string): bigint {
  return parseUnits(requirePositive(raw), 18) / 100n;
}
