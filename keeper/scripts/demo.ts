/**
 * Scripted demo (T3.1): drives a real vault on Mezo testnet into the rescue zone so the keeper
 * (or this script) rescues it, then repays the rescue.
 *
 *   pnpm demo status                 read-only snapshot (wallet, pool, vault, rescue preview)
 *   pnpm demo setup   [--send]       fund the pool, create a vault, open a loan at ~140%, set terms, opt in
 *   pnpm demo push    [--send]       borrow more so loan health drops to ~127% (below the 130% trigger)
 *   pnpm demo rescue  [--send]       call rescue() from the demo wallet (fallback if no keeper is running)
 *   pnpm demo repay   [--send]       repay the rescue lien in full
 *
 * Without --send every step only prints its plan (reads only). With --send each transaction is
 * simulated on the node first (real oracle), then sent once and never retried.
 *
 * Key: DEMO_PRIVATE_KEY (keeper/.env), else DEPLOYER_PRIVATE_KEY (contracts/.env). Never printed.
 * Optional: DEMO_COLL_BTC (collateral, default: wallet BTC minus a gas reserve), DEMO_POOL_MUSD (default 1000).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  erc20Abi,
  formatEther,
  isHex,
  parseEther,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from "viem";
import { hintHelpersAbi, positionVaultAbi, rescueMarketAbi, sortedTrovesAbi, vaultFactoryAbi } from "../src/abis.generated.js";
import { makePublicClient, makeWalletClient, type MezoPublicClient, type MezoWalletClient } from "../src/chain.js";
import { loadConfig, type Config } from "../src/config.js";
import { RESCUE_STATUS } from "../src/keeper.js";
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from "./demo-abis.generated.js";

const E18 = 10n ** 18n;
const NICR_PRECISION = 10n ** 20n;
const OPEN_ICR = (140n * E18) / 100n; // "Watch": above the trigger, below trigger + 20pp
const PUSH_ICR = (127n * E18) / 100n; // "Rescue zone": below the trigger, well above MCR (110%)
const TRIGGER_ICR = (130n * E18) / 100n; // = MCR + 20pp, the contract's minimum
const TARGET_ICR = (150n * E18) / 100n;
const MAX_RESCUE = 1_000n * E18;
const BTC_RESERVE = parseEther("0.002"); // left in the wallet for gas
const DEFAULT_POOL_DEPOSIT = 1_000n * E18;
const HINT_TRIALS = 50n;
const RECEIPT_TIMEOUT_MS = 180_000;

const DEPLOYMENTS = fileURLToPath(new URL("../../deployments/testnet.json", import.meta.url));

interface Ctx {
  cfg: Config;
  client: MezoPublicClient;
  wallet: MezoWalletClient;
  me: Address;
  musd: Address;
  bo: Address;
  tm: Address;
  pf: Address;
  send: boolean;
}

interface CallSpec {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

interface PlannedTx {
  label: string;
  /** Built lazily so each tx sees the state left by the previous one. */
  build: () => CallSpec | Promise<CallSpec>;
}

const fmt = (wad: bigint, dp = 2) => Number(formatEther(wad)).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });
const pct = (wad: bigint) => `${(Number((wad * 1000n) / E18) / 10).toFixed(1)}%`;

function demoKey(env: NodeJS.ProcessEnv): Hex {
  const raw = (env.DEMO_PRIVATE_KEY ?? env.DEPLOYER_PRIVATE_KEY ?? "").trim();
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!isHex(key) || key.length !== 66) {
    throw new Error("Set DEMO_PRIVATE_KEY in keeper/.env or DEPLOYER_PRIVATE_KEY in contracts/.env (32-byte hex).");
  }
  return key;
}

function musdAddresses(): { musd: Address; bo: Address; tm: Address; pf: Address } {
  const d = JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) as { musd: Record<string, { address: Address }> };
  const get = (name: string): Address => {
    const entry = d.musd[name];
    if (entry === undefined) throw new Error(`deployments/testnet.json: musd.${name} missing`);
    return entry.address;
  };
  return { musd: get("MUSD"), bo: get("BorrowerOperations"), tm: get("TroveManager"), pf: get("PriceFeed") };
}

async function price(c: Ctx): Promise<bigint> {
  return c.client.readContract({ address: c.pf, abi: priceFeedAbi, functionName: "fetchPrice" });
}

async function collAndDebt(c: Ctx, vault: Address): Promise<{ coll: bigint; debt: bigint }> {
  const [coll, principal, interest] = await c.client.readContract({
    address: c.tm,
    abi: troveManagerAbi,
    functionName: "getEntireDebtAndColl",
    args: [vault],
  });
  return { coll, debt: principal + interest };
}

/** Borrowing fee rate as a 1e18 fraction (governable, so read live). */
async function feeRate(c: Ctx): Promise<bigint> {
  const probe = 1_000_000n * E18;
  const fee = await c.client.readContract({ address: c.bo, abi: borrowerOperationsAbi, functionName: "getBorrowingFee", args: [probe] });
  return (fee * E18) / probe;
}

async function hints(c: Ctx, nicr: bigint): Promise<readonly [Address, Address]> {
  const seed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const [approx] = await c.client.readContract({
    address: c.cfg.hintHelpersAddress,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, HINT_TRIALS, seed],
  });
  return c.client.readContract({
    address: c.cfg.sortedTrovesAddress,
    abi: sortedTrovesAbi,
    functionName: "findInsertPosition",
    args: [nicr, approx, approx],
  });
}

/** The demo wallet's newest vault, if any. */
async function latestVault(c: Ctx): Promise<Address | undefined> {
  const vaults = await c.client.readContract({ address: c.cfg.factoryAddress, abi: vaultFactoryAbi, functionName: "vaultsOf", args: [c.me] });
  return vaults.at(-1);
}

async function hasTrove(c: Ctx, vault: Address): Promise<boolean> {
  return (await collAndDebt(c, vault)).debt > 0n;
}

async function run(c: Ctx, plan: PlannedTx[]): Promise<void> {
  console.log(`\nPlan (${c.send ? "SENDING" : "dry run, nothing sent"}):`);
  plan.forEach((tx, i) => {
    console.log(`  ${i + 1}. ${tx.label}`);
  });
  if (!c.send) {
    console.log("\nRe-run with --send to execute.");
    return;
  }
  for (const [i, tx] of plan.entries()) {
    const call = await tx.build();
    // Simulate on the node first (it runs Mezo's real oracle): a revert surfaces here, unsent.
    const { request } = await c.client.simulateContract({ account: c.wallet.account, ...call } as Parameters<MezoPublicClient["simulateContract"]>[0]);
    const hash = await c.wallet.writeContract(request as Parameters<MezoWalletClient["writeContract"]>[0]);
    console.log(`  ${i + 1}. sent ${hash}`);
    const receipt = await c.client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    console.log(`     ${receipt.status} in block ${receipt.blockNumber}`);
    if (receipt.status !== "success") throw new Error(`${tx.label}: reverted (${hash}); stopping`);
  }
}

function contractCall<const abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(
  address: Address,
  abi: abi,
  functionName: fn,
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>,
  value?: bigint,
): CallSpec {
  return { address, abi, functionName, args: args as readonly unknown[], ...(value === undefined ? {} : { value }) };
}

async function status(c: Ctx): Promise<void> {
  const [p, btc, musdBal, liquid, total, outstanding] = await Promise.all([
    price(c),
    c.client.getBalance({ address: c.me }),
    c.client.readContract({ address: c.musd, abi: erc20Abi, functionName: "balanceOf", args: [c.me] }),
    c.client.readContract({ address: c.cfg.marketAddress, abi: rescueMarketAbi, functionName: "liquidAssets" }),
    c.client.readContract({ address: c.cfg.marketAddress, abi: rescueMarketAbi, functionName: "totalAssets" }),
    c.client.readContract({ address: c.cfg.marketAddress, abi: rescueMarketAbi, functionName: "outstanding" }),
  ]);
  console.log(`Wallet ${c.me}`);
  console.log(`  BTC ${fmt(btc, 6)}   MUSD ${fmt(musdBal)}   BTC price $${fmt(p)}`);
  console.log(`Pool ${c.cfg.marketAddress}`);
  console.log(`  total ${fmt(total)} MUSD   available ${fmt(liquid)}   in rescues ${fmt(outstanding)}`);
  const vault = await latestVault(c);
  if (vault === undefined) {
    console.log("Vault: none yet (run setup)");
    return;
  }
  const [{ coll, debt }, terms, optedIn, lien, q] = await Promise.all([
    collAndDebt(c, vault),
    c.client.readContract({ address: vault, abi: positionVaultAbi, functionName: "rescueTerms" }),
    c.client.readContract({ address: vault, abi: positionVaultAbi, functionName: "optedIn" }),
    c.client.readContract({ address: vault, abi: positionVaultAbi, functionName: "lien" }),
    c.client.readContract({ address: c.cfg.marketAddress, abi: rescueMarketAbi, functionName: "previewRescue", args: [vault] }),
  ]);
  console.log(`Vault ${vault}`);
  if (debt === 0n) {
    console.log("  no loan yet");
  } else {
    console.log(`  collateral ${fmt(coll, 6)} BTC   debt ${fmt(debt)} MUSD   loan health ${pct((coll * p) / debt)}`);
  }
  console.log(`  terms trigger ${pct(terms[0])} target ${pct(terms[1])} max ${fmt(terms[2])} MUSD   opted in ${optedIn}`);
  const [lienAmount, dueBy, active] = lien;
  if (active) console.log(`  LIEN ${fmt(lienAmount)} MUSD due ${new Date(Number(dueBy) * 1000).toISOString()}`);
  console.log(
    `  rescue preview: ${RESCUE_STATUS[q.status] ?? q.status}` +
      (q.repay > 0n ? `   repay ${fmt(q.repay)}  fee ${fmt(q.fee)}  tip ${fmt(q.tip)} MUSD` : ""),
  );
}

async function setup(c: Ctx): Promise<void> {
  const [p, btc, musdBal, rate, minNetDebt, gasComp] = await Promise.all([
    price(c),
    c.client.getBalance({ address: c.me }),
    c.client.readContract({ address: c.musd, abi: erc20Abi, functionName: "balanceOf", args: [c.me] }),
    feeRate(c),
    c.client.readContract({ address: c.bo, abi: borrowerOperationsAbi, functionName: "minNetDebt" }),
    c.client.readContract({ address: c.bo, abi: borrowerOperationsAbi, functionName: "MUSD_GAS_COMPENSATION" }),
  ]);
  const coll = process.env.DEMO_COLL_BTC ? parseEther(process.env.DEMO_COLL_BTC) : btc - BTC_RESERVE;
  const deposit = process.env.DEMO_POOL_MUSD ? parseEther(process.env.DEMO_POOL_MUSD) : DEFAULT_POOL_DEPOSIT;
  if (coll <= 0n || coll > btc - BTC_RESERVE) throw new Error(`Not enough BTC: have ${fmt(btc, 6)}, need collateral + ${fmt(BTC_RESERVE, 3)} reserve`);
  if (deposit > musdBal) throw new Error(`Pool deposit ${fmt(deposit)} MUSD exceeds wallet MUSD ${fmt(musdBal)}`);

  // Open at ~140%: total debt = net·(1 + rate) + gas comp.
  const collValue = (coll * p) / E18;
  const openTotal = (collValue * E18) / OPEN_ICR;
  const openNet = ((openTotal - gasComp) * E18) / (E18 + rate);
  // After the push to ~127%, a rescue must have room above minNetDebt to repay toward 150%.
  const pushTotal = (collValue * E18) / PUSH_ICR;
  const pushNet = openNet + ((pushTotal - openTotal) * E18) / (E18 + rate);
  const expectedRepay = pushTotal - (collValue * E18) / TARGET_ICR;
  const headroom = pushNet - minNetDebt;

  console.log(`BTC price $${fmt(p)}   collateral ${fmt(coll, 6)} BTC ($${fmt(collValue)})   borrowing fee ${pct(rate)}`);
  console.log(`Open: borrow ${fmt(openNet)} MUSD (net) -> total debt ~${fmt(openTotal)} -> loan health ~${pct(OPEN_ICR)}`);
  console.log(`After push: net debt ~${fmt(pushNet)}, expected rescue repay ~${fmt(expectedRepay)} MUSD (room above min debt ${fmt(headroom)})`);
  if (openNet < minNetDebt) throw new Error(`Collateral too small: open needs net debt >= ${fmt(minNetDebt)} MUSD at 140%. Add BTC.`);
  if (headroom < expectedRepay) {
    throw new Error(`Collateral too small for a full rescue: repay ~${fmt(expectedRepay)} > room ${fmt(headroom)} above min debt. Add BTC.`);
  }
  if (expectedRepay > deposit) throw new Error(`Pool deposit ${fmt(deposit)} is below the expected repay ${fmt(expectedRepay)}`);

  const existing = await latestVault(c);
  const reuse = existing !== undefined && !(await hasTrove(c, existing));
  const vaultRef: { addr: Address | undefined } = { addr: reuse ? existing : undefined };
  const vault = async (): Promise<Address> => {
    vaultRef.addr ??= await latestVault(c);
    if (vaultRef.addr === undefined) throw new Error("vault not found after createVault");
    return vaultRef.addr;
  };

  const plan: PlannedTx[] = [
    {
      label: `MUSD.approve(RescueMarket, ${fmt(deposit)})`,
      build: () => contractCall(c.musd, erc20Abi, "approve", [c.cfg.marketAddress, deposit]),
    },
    {
      label: `RescueMarket.deposit(${fmt(deposit)} MUSD)  (demo wallet acts as the rescue provider)`,
      build: () => contractCall(c.cfg.marketAddress, rescueMarketAbi, "deposit", [deposit]),
    },
  ];
  if (!reuse) {
    plan.push({ label: "VaultFactory.createVault()", build: () => contractCall(c.cfg.factoryAddress, vaultFactoryAbi, "createVault", []) });
  }
  plan.push(
    {
      label: `vault.open(${fmt(openNet)} MUSD) with ${fmt(coll, 6)} BTC  ->  loan health ~${pct(OPEN_ICR)}${reuse ? ` (reusing empty vault ${existing})` : ""}`,
      build: async () => {
        const [upper, lower] = await hints(c, (coll * NICR_PRECISION) / openTotal);
        return contractCall(await vault(), positionVaultAbi, "open", [openNet, upper, lower], coll);
      },
    },
    {
      label: `vault.setRescueTerms(trigger ${pct(TRIGGER_ICR)}, target ${pct(TARGET_ICR)}, max ${fmt(MAX_RESCUE)} MUSD)`,
      build: async () => contractCall(await vault(), positionVaultAbi, "setRescueTerms", [TRIGGER_ICR, TARGET_ICR, MAX_RESCUE]),
    },
    { label: "vault.optIn()", build: async () => contractCall(await vault(), positionVaultAbi, "optIn", []) },
  );
  await run(c, plan);
}

async function requireVault(c: Ctx): Promise<Address> {
  const vault = await latestVault(c);
  if (vault === undefined) throw new Error("No vault yet: run setup first");
  return vault;
}

async function push(c: Ctx): Promise<void> {
  const vault = await requireVault(c);
  const [p, rate, { coll, debt }] = await Promise.all([price(c), feeRate(c), collAndDebt(c, vault)]);
  if (debt === 0n) throw new Error("Vault has no loan: run setup first");
  const collValue = (coll * p) / E18;
  const now = (collValue * E18) / debt;
  if (now <= PUSH_ICR) throw new Error(`Loan health is already ${pct(now)} (at or below ${pct(PUSH_ICR)})`);
  const targetDebt = (collValue * E18) / PUSH_ICR;
  const amount = ((targetDebt - debt) * E18) / (E18 + rate);
  console.log(`Vault ${vault}: loan health ${pct(now)} -> ~${pct(PUSH_ICR)} (trigger ${pct(TRIGGER_ICR)})`);
  await run(c, [
    {
      label: `vault.borrow(${fmt(amount)} MUSD)  ->  loan health ~${pct(PUSH_ICR)}, inside the rescue zone`,
      build: async () => {
        const [upper, lower] = await hints(c, (coll * NICR_PRECISION) / targetDebt);
        return contractCall(vault, positionVaultAbi, "borrow", [amount, upper, lower]);
      },
    },
  ]);
}

async function rescue(c: Ctx): Promise<void> {
  const vault = await requireVault(c);
  const q = await c.client.readContract({ address: c.cfg.marketAddress, abi: rescueMarketAbi, functionName: "previewRescue", args: [vault] });
  const st = RESCUE_STATUS[q.status] ?? String(q.status);
  if (st !== "Ok") throw new Error(`Not rescuable now: ${st}`);
  console.log(`Preview: loan health ${pct(q.icr)}, repay ${fmt(q.repay)}, fee ${fmt(q.fee)}, tip ${fmt(q.tip)} MUSD`);
  await run(c, [
    {
      label: `RescueMarket.rescue(${vault})  (tip ${fmt(q.tip)} MUSD to the demo wallet)`,
      build: async () => {
        const [upper, lower] = await hints(c, q.newNICR);
        return contractCall(c.cfg.marketAddress, rescueMarketAbi, "rescue", [vault, upper, lower]);
      },
    },
  ]);
}

async function repay(c: Ctx): Promise<void> {
  const vault = await requireVault(c);
  const [amount, , active] = await c.client.readContract({ address: vault, abi: positionVaultAbi, functionName: "lien" });
  if (!active) throw new Error("No active lien on the vault");
  await run(c, [
    { label: `MUSD.approve(RescueMarket, ${fmt(amount)})`, build: () => contractCall(c.musd, erc20Abi, "approve", [c.cfg.marketAddress, amount]) },
    { label: `RescueMarket.repayLien(${vault})  (${fmt(amount)} MUSD: repaid debt + fee + tip)`, build: () => contractCall(c.cfg.marketAddress, rescueMarketAbi, "repayLien", [vault]) },
  ]);
}

async function main(): Promise<void> {
  const [step = "status", ...rest] = process.argv.slice(2);
  const cfg = loadConfig(process.env, [], DEPLOYMENTS);
  const client = makePublicClient(cfg.rpcUrl);
  const chainId = await client.getChainId();
  if (chainId !== 31_611) throw new Error(`Refusing to run on chain ${chainId}: Mezo testnet (31611) only`);
  const wallet = makeWalletClient(cfg.rpcUrl, demoKey(process.env));
  const c: Ctx = { cfg, client, wallet, me: wallet.account.address, ...musdAddresses(), send: rest.includes("--send") };
  const steps: Record<string, (ctx: Ctx) => Promise<void>> = { status, setup, push, rescue, repay };
  const fn = steps[step];
  if (fn === undefined) throw new Error(`Unknown step "${step}". Use: ${Object.keys(steps).join(", ")}`);
  await fn(c);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
