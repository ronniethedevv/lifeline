import type { Address, PublicClient } from "viem";
import { hintHelpers, sortedTroves } from "./contracts";

/** Random trials for HintHelpers.getApproxHint (view call; cost is only RPC time). Matches the keeper. */
const HINT_TRIALS = 50n;

/**
 * Insert-position hints for a trove with the given nominal ICR (1e20 scale).
 * Hints only steer MUSD's sorted-list walk; an approximate result just costs gas, never a revert.
 */
export async function computeHints(
  client: PublicClient,
  nominalICR: bigint,
): Promise<{ upperHint: Address; lowerHint: Address }> {
  const seed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const [approx] = await client.readContract({
    ...hintHelpers,
    functionName: "getApproxHint",
    args: [nominalICR, HINT_TRIALS, seed],
  });
  const [upperHint, lowerHint] = await client.readContract({
    ...sortedTroves,
    functionName: "findInsertPosition",
    args: [nominalICR, approx, approx],
  });
  return { upperHint, lowerHint };
}
