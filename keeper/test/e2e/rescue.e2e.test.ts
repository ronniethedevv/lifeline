/**
 * T2.1 end-to-end: the real keeper (viem port) rescues an at-risk vault on a local anvil fork of
 * Mezo testnet. Mezo's oracle precompile can't run in anvil (same as Forge), so the oracle address
 * gets MockMezoOracle code seeded with the real oracle's price at the fork block; everything else
 * is real MUSD. Lifeline is deployed with viem in Deploy.s.sol's order (pricer -> factory with the
 * predicted market address -> market) so the real deployment's broadcast logs aren't touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  getContractAddress,
  http,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hintHelpersAbi,
  positionVaultAbi,
  rescueMarketAbi,
  sortedTrovesAbi,
  vaultFactoryAbi,
} from "../../src/abis.generated.js";
import { makePublicClient, makeWalletClient, mezoTestnet, type MezoPublicClient } from "../../src/chain.js";
import { chainPort } from "../../src/chainPort.js";
import type { Config } from "../../src/config.js";
import { runOnce } from "../../src/keeper.js";
import { createLogger } from "../../src/log.js";
import {
  borrowerOperationsAbi,
  erc20Abi,
  minimalFeePricerAbi,
  minimalFeePricerBytecode,
  mockMezoOracleAbi,
  mockMezoOracleRuntime,
  rescueMarketBytecode,
  troveManagerAbi,
  priceFeedAbi,
  vaultFactoryBytecode,
} from "./artifacts.generated.js";

const MEZO_RPC = process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org";
const FORK_BLOCK = 16_185_009n; // same pinned block as contracts/test/fork (MezoForkBase)
const ANVIL_PORT = 8547;
const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
/** A cold anvil fork fetches every storage slot from Mezo's RPC: setup calls can take minutes. */
const ANVIL_TIMEOUT_MS = 10 * 60_000;

// deployments/testnet.json (T0.3)
const BO = "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5" as Address;
const TM = "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0" as Address;
const PF = "0x86bCF0841622a5dAC14A313a15f96A95421b9366" as Address;
const HH = "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6" as Address;
const ST = "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA" as Address;
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address;
const ORACLE = getAddress("0x7b7c000000000000000000000000000000000015"); // Mezo oracle precompile

// anvil's well-known dev keys (local fork only, never real funds)
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  alice: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  keeper: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;

const E18 = 10n ** 18n;
const POOL = 10_000n * E18;
const VAULT_DEBT = 5_000n * E18;

let anvil: ChildProcess | undefined;
let client: MezoPublicClient;
let market: Address;
let factory: Address;
let vault: Address;

function wallet(key: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: mezoTestnet,
    transport: http(ANVIL_URL, { timeout: ANVIL_TIMEOUT_MS }),
  });
}

/** Insert hints for a trove with `coll` / composite `debt` (avoids walking the whole sorted list). */
async function hintsFor(coll: bigint, debt: bigint): Promise<readonly [Address, Address]> {
  const nicr = (coll * 10n ** 20n) / debt;
  const [approx] = await client.readContract({ address: HH, abi: hintHelpersAbi, functionName: "getApproxHint", args: [nicr, 50n, 42n] });
  return client.readContract({ address: ST, abi: sortedTrovesAbi, functionName: "findInsertPosition", args: [nicr, approx, approx] });
}

async function waitForAnvil(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await makePublicClient(ANVIL_URL).getChainId();
      return;
    } catch {
      await sleep(1_000);
    }
  }
  throw new Error("anvil did not start");
}

async function send(hash: Promise<Hex>): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash: await hash });
  if (receipt.status !== "success") throw new Error(`tx reverted: ${receipt.transactionHash}`);
}

async function deploy(w: ReturnType<typeof wallet>, hash: Promise<Hex>): Promise<Address> {
  const receipt = await client.waitForTransactionReceipt({ hash: await hash });
  if (receipt.contractAddress == null) throw new Error(`deploy failed: ${receipt.transactionHash} from ${w.account.address}`);
  return getAddress(receipt.contractAddress);
}

function keeperConfig(live: boolean): Config {
  return {
    rpcUrl: ANVIL_URL,
    marketAddress: market,
    factoryAddress: factory,
    hintHelpersAddress: HH,
    sortedTrovesAddress: ST,
    keeperKey: live ? KEYS.keeper : undefined,
    live,
    pollIntervalMs: 1_000,
    readConcurrency: 4,
  };
}

/** Collateral for `icr` at the current price, and the insert hints for the resulting trove. */
async function troveFor(debt: bigint, icr: bigint): Promise<{ coll: bigint; upper: Address; lower: Address }> {
  const fee = await client.readContract({ address: BO, abi: borrowerOperationsAbi, functionName: "getBorrowingFee", args: [debt] });
  const gasComp = await client.readContract({ address: BO, abi: borrowerOperationsAbi, functionName: "MUSD_GAS_COMPENSATION" });
  const price = await client.readContract({ address: PF, abi: priceFeedAbi, functionName: "fetchPrice" });
  const composite = debt + fee + gasComp;
  const coll = (composite * icr) / price + 1n;
  const [upper, lower] = await hintsFor(coll, composite);
  return { coll, upper, lower };
}

beforeAll(async () => {
  anvil = spawn(
    "anvil",
    ["--fork-url", MEZO_RPC, "--fork-block-number", FORK_BLOCK.toString(), "--port", String(ANVIL_PORT), "--retries", "10", "--timeout", "60000", "--silent"],
    { stdio: "ignore" },
  );
  await waitForAnvil();
  client = createPublicClient({ chain: mezoTestnet, transport: http(ANVIL_URL, { timeout: ANVIL_TIMEOUT_MS, retryCount: 2 }) });

  // Real oracle values at the fork block, read from the real node (which runs the precompile).
  const real = makePublicClient(MEZO_RPC);
  const [, answer] = await real.readContract({ address: ORACLE, abi: mockMezoOracleAbi, functionName: "latestRoundData", blockNumber: FORK_BLOCK });
  const decimals = await real.readContract({ address: ORACLE, abi: mockMezoOracleAbi, functionName: "decimals", blockNumber: FORK_BLOCK });

  const test = createTestClient({ mode: "anvil", chain: mezoTestnet, transport: http(ANVIL_URL) });
  await test.setCode({ address: ORACLE, bytecode: mockMezoOracleRuntime });
  const deployer = wallet(KEYS.deployer);
  await send(deployer.writeContract({ address: ORACLE, abi: mockMezoOracleAbi, functionName: "setDecimals", args: [decimals] }));
  await send(deployer.writeContract({ address: ORACLE, abi: mockMezoOracleAbi, functionName: "setPrice", args: [answer] }));

  // Deploy Lifeline like Deploy.s.sol: pricer (n), factory (n+1, market predicted), market (n+2).
  const mcr = await client.readContract({ address: TM, abi: troveManagerAbi, functionName: "MCR" });
  const ccr = await client.readContract({ address: TM, abi: troveManagerAbi, functionName: "CCR" });
  const nonce = await client.getTransactionCount({ address: deployer.account.address });
  const predicted = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce) + 2n });
  const pricer = await deploy(deployer, deployer.deployContract({ abi: minimalFeePricerAbi, bytecode: minimalFeePricerBytecode, args: [100n, 500n, mcr, ccr] }));
  factory = await deploy(deployer, deployer.deployContract({ abi: vaultFactoryAbi, bytecode: vaultFactoryBytecode, args: [BO, TM, MUSD, predicted] }));
  market = await deploy(
    deployer,
    deployer.deployContract({ abi: rescueMarketAbi, bytecode: rescueMarketBytecode, args: [MUSD, BO, TM, PF, pricer, factory, 7n * 24n * 3600n, 10n] }),
  );
  expect(market).toBe(predicted);

  // Provider: borrow MUSD from its own trove (300% ICR) and fund the pool.
  const provider = wallet(KEYS.provider);
  const pt = await troveFor(POOL, 3n * E18);
  await send(provider.writeContract({ address: BO, abi: borrowerOperationsAbi, functionName: "openTrove", args: [POOL, pt.upper, pt.lower], value: pt.coll }));
  await send(provider.writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [market, maxUint256] }));
  await send(provider.writeContract({ address: market, abi: rescueMarketAbi, functionName: "deposit", args: [POOL] }));

  // Alice: vault at ~200% ICR, trigger 150% / target 170%, opted in.
  const alice = wallet(KEYS.alice);
  await send(alice.writeContract({ address: factory, abi: vaultFactoryAbi, functionName: "createVault" }));
  const vaults = await client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: "vaultsOf", args: [alice.account.address] });
  const v = vaults[0];
  if (v === undefined) throw new Error("vault not created");
  vault = v;
  const at = await troveFor(VAULT_DEBT, 2n * E18);
  await send(alice.writeContract({ address: vault, abi: positionVaultAbi, functionName: "open", args: [VAULT_DEBT, at.upper, at.lower], value: at.coll }));
  await send(alice.writeContract({ address: vault, abi: positionVaultAbi, functionName: "setRescueTerms", args: [15n * E18 / 10n, 17n * E18 / 10n, VAULT_DEBT] }));
  await send(alice.writeContract({ address: vault, abi: positionVaultAbi, functionName: "optIn" }));

  // BTC drops 30%: ~200% -> ~140%, below the 150% trigger.
  await send(deployer.writeContract({ address: ORACLE, abi: mockMezoOracleAbi, functionName: "setPrice", args: [(answer * 70n) / 100n] }));
});

afterAll(() => {
  anvil?.kill();
});

describe("keeper e2e (anvil fork of Mezo testnet)", () => {
  it("dry run finds the at-risk vault and sends nothing", async () => {
    const out = await runOnce(chainPort(keeperConfig(false), client), { live: false, readConcurrency: 4 }, createLogger());
    expect(out).toEqual([expect.objectContaining({ vault, action: "would-rescue" })]);
    const [, , active] = await client.readContract({ address: vault, abi: positionVaultAbi, functionName: "lien" });
    expect(active).toBe(false);
  });

  it("live run rescues it: lien recorded, keeper tipped, ICR restored", async () => {
    const cfg = keeperConfig(true);
    const keeperWallet = makeWalletClient(ANVIL_URL, KEYS.keeper);
    const out = await runOnce(chainPort(cfg, client, keeperWallet), { live: true, readConcurrency: 4 }, createLogger());

    const result = out[0];
    expect(result).toMatchObject({ vault, action: "rescued", receipt: { status: "success" } });
    if (result?.action !== "rescued") throw new Error("not rescued");

    // Executed amounts (from the Rescued event) match on-chain state exactly; they may differ
    // slightly from the preview because interest accrues before the rescue lands.
    const executed = result.receipt.executed;
    if (executed === undefined) throw new Error("no Rescued event in receipt");
    const [amount, , active] = await client.readContract({ address: vault, abi: positionVaultAbi, functionName: "lien" });
    expect(active).toBe(true);
    expect(amount).toBe(executed.repaid + executed.fee + executed.tip);
    expect(executed.repaid).toBeGreaterThanOrEqual(result.quote.repay);
    expect(executed.repaid - result.quote.repay).toBeLessThan(E18 / 1000n); // < 0.001 MUSD drift

    const tip = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [keeperWallet.account.address] });
    expect(tip).toBe(executed.tip);

    const price = await client.readContract({ address: PF, abi: priceFeedAbi, functionName: "fetchPrice" });
    const icr = await client.readContract({ address: TM, abi: troveManagerAbi, functionName: "getCurrentICR", args: [vault, price] });
    expect(icr >= 17n * E18 / 10n).toBe(true);
  });

  it("next poll is idempotent: the vault reports LienActive and nothing is re-sent", async () => {
    const keeperWallet = makeWalletClient(ANVIL_URL, KEYS.keeper);
    const out = await runOnce(chainPort(keeperConfig(true), client, keeperWallet), { live: true, readConcurrency: 4 }, createLogger());
    expect(out).toEqual([{ vault, action: "skipped", status: "LienActive" }]);
  });
});
