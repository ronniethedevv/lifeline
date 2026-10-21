/**
 * Client-side mirror of the deployed FuzzyFeePricer (deployments/testnet.json). Same 1e18 fixed-point
 * math and 27-cell committed table as the contract, so the explorer responds instantly; the page also
 * reads `feeBps()` live to prove it matches on-chain. The contract is immutable, so these never change.
 */

const ONE = 10n ** 18n;

export const MIN_FEE_BPS = 100n; // 1%
export const MAX_FEE_BPS = 1000n; // 10%

/** Breakpoints (1e18 = 100%), committed at deploy: ICR 110/125/150, size 5/20/40, TCR 150/170/200. */
export const ICR_KNOTS: readonly [bigint, bigint, bigint] = [(110n * ONE) / 100n, (125n * ONE) / 100n, (150n * ONE) / 100n];
export const SIZE_KNOTS: readonly [bigint, bigint, bigint] = [(5n * ONE) / 100n, (20n * ONE) / 100n, (40n * ONE) / 100n];
export const TCR_KNOTS: readonly [bigint, bigint, bigint] = [(150n * ONE) / 100n, (170n * ONE) / 100n, (200n * ONE) / 100n];

// Per-axis risk weights (ICR dominates); the 27 consequents are derived the same way as the deploy.
const R1: readonly [bigint, bigint, bigint] = [16n, 6n, 0n]; // ICR: at-liquidation -> safe
const R2: readonly [bigint, bigint, bigint] = [0n, 4n, 10n]; // size: small -> large
const R3: readonly [bigint, bigint, bigint] = [8n, 3n, 0n]; // TCR: Recovery -> healthy
const RMAX = 34n;

/** The committed 27 consequents (bps), indexed `i*9 + j*3 + k`. */
export const RULES: readonly bigint[] = (() => {
  const r: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        r[i * 9 + j * 3 + k] = MIN_FEE_BPS + ((MAX_FEE_BPS - MIN_FEE_BPS) * (R1[i] + R2[j] + R3[k])) / RMAX;
      }
    }
  }
  return r;
})();

function memberships(x: bigint, knots: readonly [bigint, bigint, bigint]): [bigint, bigint, bigint] {
  const [lo, mid, hi] = knots;
  if (x <= lo) return [ONE, 0n, 0n];
  if (x <= mid) {
    const up = ((x - lo) * ONE) / (mid - lo);
    return [ONE - up, up, 0n];
  }
  if (x <= hi) {
    const up = ((x - mid) * ONE) / (hi - mid);
    return [0n, ONE - up, up];
  }
  return [0n, 0n, ONE];
}

/** Fee in bps for the given state; mirrors FuzzyFeePricer.feeBps exactly (all inputs 1e18 = 100%). */
export function feeBps(icr: bigint, sizeRatio: bigint, tcr: bigint): bigint {
  const mi = memberships(icr, ICR_KNOTS);
  const mj = memberships(sizeRatio, SIZE_KNOTS);
  const mk = memberships(tcr, TCR_KNOTS);
  let acc = 0n;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const mij = mi[i] * mj[j];
      for (let k = 0; k < 3; k++) {
        acc += mij * mk[k] * RULES[i * 9 + j * 3 + k];
      }
    }
  }
  let fee = acc / (ONE * ONE * ONE);
  if (fee < MIN_FEE_BPS) fee = MIN_FEE_BPS;
  if (fee > MAX_FEE_BPS) fee = MAX_FEE_BPS;
  return fee;
}

/** A percent like 130 to a 1e18 ratio (130 -> 1.30e18). */
export function pctToWad(pct: number): bigint {
  return (BigInt(Math.round(pct * 100)) * ONE) / 10000n;
}

/** bps (e.g. 444n) to a display string "4.44%". */
export function bpsToPct(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}
