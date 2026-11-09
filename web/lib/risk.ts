/**
 * Loan-health classification and ratio math. Pure and unit-tested.
 * All ratios use MUSD's convention: 1e18 = 100%. NICR uses 1e20 (RescueMarket.NICR_PRECISION).
 */

/** Watch band: "safe" means ICR is at least 20 percentage points above the trigger (ui_context.md). */
export const WATCH_BAND = 200000000000000000n; // 0.2 * 1e18

/** NICR scale, must match RescueMarket.NICR_PRECISION for insert hints. */
export const NICR_PRECISION = 10n ** 20n;

export type RiskState = "no-trove" | "unprotected" | "safe" | "watch" | "danger" | "lien";

export interface RiskInputs {
  hasTrove: boolean;
  lienActive: boolean;
  optedIn: boolean;
  icr: bigint; // 1e18 = 100%
  triggerICR: bigint; // 1e18
}

/** Risk state per the ui_context.md table, extended with no-trove / unprotected cases. */
export function classifyRisk({ hasTrove, lienActive, optedIn, icr, triggerICR }: RiskInputs): RiskState {
  if (!hasTrove) return "no-trove";
  if (lienActive) return "lien";
  if (!optedIn || triggerICR === 0n) return "unprotected";
  if (icr >= triggerICR + WATCH_BAND) return "safe";
  if (icr >= triggerICR) return "watch";
  return "danger";
}

/** Label + design token (ui_context.md) for each risk state. */
export const RISK_META: Record<RiskState, { label: string; token: "safe" | "watch" | "danger" | "lien" | "text-muted" }> = {
  "no-trove": { label: "No loan", token: "text-muted" },
  unprotected: { label: "Unprotected", token: "watch" },
  safe: { label: "Safe", token: "safe" },
  watch: { label: "Watch", token: "watch" },
  danger: { label: "Rescue zone", token: "danger" },
  lien: { label: "Rescued", token: "lien" },
};

/** Individual collateral ratio from collateral, debt and price. Matches TroveManager.getCurrentICR. */
export function currentICR(coll: bigint, debt: bigint, price: bigint): bigint {
  if (debt === 0n) return 0n;
  return (coll * price) / debt; // 1e18
}

/** Nominal (price-independent) ICR, for SortedTroves insert hints. Matches MUSD's 1e20 scale. */
export function nominalICR(coll: bigint, debt: bigint): bigint {
  if (debt === 0n) return coll === 0n ? 0n : 2n ** 256n - 1n;
  return (coll * NICR_PRECISION) / debt;
}

/** BTC price (1e18) at which this trove reaches the liquidation ratio (MCR). 0 if no collateral. */
export function liquidationPrice(coll: bigint, debt: bigint, mcr: bigint): bigint {
  if (coll === 0n) return 0n;
  return (mcr * debt) / coll; // 1e18 MUSD per BTC
}

export interface Terms {
  mcr: bigint;
  triggerICR: bigint;
  targetICR: bigint;
  maxRescue: bigint;
}

/** Must match PositionVault.MIN_TRIGGER_BUFFER: the trigger sits at least 20 points above MCR (T1.7b). */
export const MIN_TRIGGER_BUFFER = 200000000000000000n; // 0.2 * 1e18

/** Terms used to size rescue room before a borrower has set their own (the form's placeholders). */
export const DEFAULT_TRIGGER_ICR = 1300000000000000000n; // 130%
export const DEFAULT_TARGET_ICR = 1500000000000000000n; // 150%

export type RescueRoomLevel = "none" | "partial" | "full";

export interface RescueRoom {
  /** MUSD a rescue may repay before MUSD's min-net-debt rule blocks it. */
  room: bigint;
  /** MUSD a rescue fired exactly at the trigger must repay to restore the target. */
  needed: bigint;
  level: RescueRoomLevel;
}

/**
 * How much a rescue can repay versus how much one needs. Mirrors RescueMarket._repayAmount's cap:
 * room = max(0, debt − gasComp − minNetDebt). At ICR = trigger the collateral is worth
 * trigger·debt, so restoring the target repays debt·(1 − trigger/target).
 */
export function rescueRoom(p: {
  debt: bigint;
  gasComp: bigint;
  minNetDebt: bigint;
  triggerICR: bigint;
  targetICR: bigint;
}): RescueRoom {
  const net = p.debt > p.gasComp ? p.debt - p.gasComp : 0n;
  const room = net > p.minNetDebt ? net - p.minNetDebt : 0n;
  const needed = p.triggerICR > 0n && p.targetICR > p.triggerICR ? p.debt - (p.debt * p.triggerICR) / p.targetICR : 0n;
  const level: RescueRoomLevel = room === 0n ? "none" : room < needed ? "partial" : "full";
  return { room, needed, level };
}

/**
 * Smallest net borrow (excluding the gas reserve) whose rescue room covers a full rescue at the
 * trigger: N − min ≥ (N + gas)·(1 − t/T)  ⇔  N ≥ (min·T + gas·(T − t)) / t. Rounded up.
 */
export function minBorrowForFullRescue(minNetDebt: bigint, gasComp: bigint, triggerICR: bigint, targetICR: bigint): bigint {
  if (triggerICR === 0n || targetICR <= triggerICR) return minNetDebt;
  const num = minNetDebt * targetICR + gasComp * (targetICR - triggerICR);
  return (num + triggerICR - 1n) / triggerICR;
}

/** Rescue-terms validation (trigger >= MCR + 20pp, trigger < target, maxRescue > 0). Null if valid. */
export function validateTerms({ mcr, triggerICR, targetICR, maxRescue }: Terms): string | null {
  if (triggerICR < mcr + MIN_TRIGGER_BUFFER) return "Trigger must be at least 20 points above the liquidation ratio.";
  if (targetICR <= triggerICR) return "Target must be above the trigger.";
  if (maxRescue === 0n) return "Max rescue must be greater than zero.";
  return null;
}
