"use client";

import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { troveManager, priceFeed, vault } from "@/lib/contracts";
import { classifyRisk, type RiskState } from "@/lib/risk";

/** MUSD TroveManager.Status enum: index 1 is an active trove. */
const STATUS_ACTIVE = 1;

export interface VaultSummary {
  isLoading: boolean;
  owner?: Address;
  hasTrove: boolean;
  coll: bigint; // entire collateral, 1e18 BTC
  debt: bigint; // entire debt (principal + interest + pending), 1e18 MUSD
  price?: bigint; // 1e18 MUSD per BTC
  mcr?: bigint; // 1e18
  icr?: bigint; // 1e18, undefined until price loads
  liqPrice?: bigint; // 1e18, price at which ICR hits MCR
  optedIn: boolean;
  terms: { triggerICR: bigint; targetICR: bigint; maxRescue: bigint };
  lien: { amount: bigint; dueBy: bigint; active: boolean };
  risk: RiskState;
  refetch: () => void;
}

/** Reads a vault's trove health, rescue terms and lien from our contracts + MUSD. Polls every 15s. */
export function useVaultSummary(address: Address): VaultSummary {
  const v = vault(address);
  const { data, refetch, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...priceFeed, functionName: "fetchPrice" }, // 0
      { ...troveManager, functionName: "MCR" }, // 1
      { ...troveManager, functionName: "getTroveStatus", args: [address] }, // 2
      { ...troveManager, functionName: "getEntireDebtAndColl", args: [address] }, // 3
      { ...v, functionName: "owner" }, // 4
      { ...v, functionName: "optedIn" }, // 5
      { ...v, functionName: "rescueTerms" }, // 6
      { ...v, functionName: "lien" }, // 7
    ],
    query: { refetchInterval: 15_000 },
  });

  const price = data?.[0]?.result as bigint | undefined;
  const mcr = data?.[1]?.result as bigint | undefined;
  const status = data?.[2]?.result as number | undefined;
  const dc = data?.[3]?.result as readonly bigint[] | undefined;
  const owner = data?.[4]?.result as Address | undefined;
  const optedIn = (data?.[5]?.result as boolean | undefined) ?? false;
  const termsRaw = data?.[6]?.result as readonly [bigint, bigint, bigint] | undefined;
  const lienRaw = data?.[7]?.result as readonly [bigint, bigint, boolean] | undefined;

  const hasTrove = status === STATUS_ACTIVE;
  const coll = dc ? dc[0] + dc[3] : 0n; // coll + pendingCollateral
  const debt = dc ? dc[1] + dc[2] + dc[4] + dc[5] : 0n; // principal + interest + pending
  const terms = {
    triggerICR: termsRaw?.[0] ?? 0n,
    targetICR: termsRaw?.[1] ?? 0n,
    maxRescue: termsRaw?.[2] ?? 0n,
  };
  const lien = { amount: lienRaw?.[0] ?? 0n, dueBy: lienRaw?.[1] ?? 0n, active: lienRaw?.[2] ?? false };

  // ICR depends on the live price, so it is a second, gated read (matches getCurrentICR exactly).
  const { data: icrData } = useReadContract({
    ...troveManager,
    functionName: "getCurrentICR",
    args: price !== undefined ? [address, price] : undefined,
    query: { enabled: price !== undefined && hasTrove, refetchInterval: 15_000 },
  });
  const icr = icrData as bigint | undefined;

  const liqPrice = price !== undefined && mcr !== undefined && icr !== undefined && icr > 0n ? (price * mcr) / icr : undefined;

  const risk = classifyRisk({
    hasTrove,
    lienActive: lien.active,
    optedIn,
    icr: icr ?? 0n,
    triggerICR: terms.triggerICR,
  });

  return {
    isLoading,
    owner,
    hasTrove,
    coll,
    debt,
    price,
    mcr,
    icr,
    liqPrice,
    optedIn,
    terms,
    lien,
    risk,
    refetch,
  };
}
