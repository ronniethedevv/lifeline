# Architecture

## 1. Tiers
Adapted from the spec-first blueprint, cut down to what a buildathon rescue market needs.
No backend server, database, indexer or job platform: the chain is the database, and the
keeper is the only off-chain process.

```
┌───────────────────────────── Frontend (Next.js + viem/wagmi + Mezo Passport) ─┐
│ Vault dashboard · Rescue settings · Provider pool · Lien status               │
└──────────────┬──────────────────────────────────────────────┬────────────────┘
               │ JSON-RPC (reads, signed txs)                  │
┌──────────────▼──────────────────────────────────┐   ┌────────▼───────────────┐
│ Lifeline contracts (Mezo testnet, chain 31611)  │◄──│ Keeper bot (TS + viem) │
│ VaultFactory · PositionVault · RescueMarket ·   │   │ polls ICRs, calls      │
│ FuzzyFeePricer                                  │   │ rescue() / claimLien() │
└──────────────┬──────────────────────────────────┘   └────────────────────────┘
               │ calls
┌──────────────▼──────────────────────────────────┐
│ MUSD protocol (Mezo): BorrowerOperations ·      │
│ TroveManager · PriceFeed · MUSD token           │
└─────────────────────────────────────────────────┘
```

## 2. Contracts

### VaultFactory
- `createVault() returns (address)` — deploys a PositionVault owned by `msg.sender`.
- One vault per position (MUSD binds one trove to one address).
- Emits `VaultCreated(owner, vault)`. Keeps `vaultsOf(owner)` and `allVaults` for keepers.
- `isVault(address)`: true only for vaults it created. RescueMarket rescues only these, so a fake
  "vault" can't take pool MUSD without recording a lien (T1.6).
- Deploy wiring: pricer → predict the market's address (deployer nonce + 1) → factory(market =
  predicted) → market. The market constructor reverts unless `factory.market() == address(this)`.

### PositionVault
Owns exactly one MUSD trove. Holds BTC (native) and MUSD while passing them through.
- Owner functions: `open(debt, hints)` payable, `addColl` payable, `withdrawColl`,
  `borrow`, `repay`, `close`, `refinance`, `setRescueTerms(trigger, target, maxRescue)`,
  `optIn()/optOut()`.
- Market-only functions: `applyRescue(amount, fee, dueBy, hints)`, `clearLien()`, `seizeForLien(btcAmount)`.
  The market address is an immutable constructor arg of the factory and every vault.
- Lien state: `{ amount, dueBy, active }` (amount = repay + fee + keeper tip).
- Rules:
  - While a lien is active: `withdrawColl`, `close`, `borrow`, `claimCollateral`, `optOut` and
    `setRescueTerms` revert. Wave 1: the borrower repays via `RescueMarket.repayLien` first
    (2 txs); a single-call repay-and-withdraw is a possible Wave 2 addition (decision T1.3).
  - `addColl`, `repay`, `refinance` stay allowed (none weakens the lien holder).
  - `seizeForLien` only after `dueBy`, only up to lien value + penalty at current price.
- Forwards BTC received from MUSD (withdrawals, surplus claims) to owner, except during
  seizure.

### RescueMarket
- Providers: `deposit(musd)` → shares; `withdraw(shares)` → MUSD + accrued fees (pro rata,
  ERC-4626-style share math, no external token needed in Wave 1).
- `rescue(vault, hints)` (anyone):
  1. Check `factory.isVault`, opted in, no active lien, ICR < trigger (live PriceFeed price).
  2. Repay = debt − coll·price/target, capped by `maxRescue`, pool liquidity (repay + tip must
     fit) and MUSD's min-net-debt headroom (`net debt − minNetDebt`, T1.3). Partial if capped.
  3. Fee = repay × `pricer.feeBps(icr, repay/collValue, TCR)` (rounded up). Wave 1 pricer:
     MinimalFeePricer; Wave 2: FuzzyFeePricer behind the same `IFeePricer`.
  4. Tip = repay × `tipBps`, paid by the pool to the caller and added to the lien (the borrower
     pays it). `outstanding += repay + tip`; pool value unchanged (cash → receivable).
  5. Transfer repay MUSD to vault, call `vault.applyRescue(repay, fee + tip, now + lienTerm)`.
- `previewRescue(vault)` returns status, ICR, repay, fee, tip and post-rescue NICR (for hints)
  without reverting: keepers use it for hints, the UI to show cost before signing.
- Withdrawals are limited to liquid MUSD (`totalAssets − outstanding`).
- `repayLien(vault)` — borrower pays lien MUSD back; fee goes to providers.
- `claimLien(vault)` (anyone, after `dueBy`) — seizes BTC; BTC is held by the pool and
  shares carry a claim on it (Wave 1: providers withdraw pro-rata BTC + MUSD).

### FuzzyFeePricer
Zero-order Sugeno fuzzy system, all fixed-point (1e18), no `exp`.
- Inputs (all read on-chain, no external oracle):
  1. Distance to liquidation: `ICR − 110%`
  2. Rescue size relative to collateral value
  3. System health: TCR distance from 150% (Recovery Mode)
- Triangular/trapezoid memberships (Low/Med/High), 9–27 rules, each rule → constant fee bps.
- Output = weighted average of rule outputs, clamped to `[minFeeBps, maxFeeBps]`.
- Rule table and breakpoints fixed in the constructor and emitted in an event (the commitment).
- Pure/view, gas target < 150k.
- Wave 2: `GNPricer` implementing the same `IFeePricer` interface (sigmoid + Gaussian via
  PRBMath SD59x18).

## 3. MUSD integration facts (from mezo-org/musd docs and code)
- Trove bound to one address; plain `addColl/withdrawColl/repayMUSD/withdrawMUSD` act on
  `msg.sender`'s trove → vault must be the caller.
- Liquidation below 110% ICR; Recovery Mode when TCR < 150% (blocks closing, debt increase
  must raise ICR above 150%, no refinance).
- Redemptions hit the lowest-ICR trove above 110% first; they reduce debt and collateral
  1:1 in dollar terms. Surplus goes to `CollSurplusPool` → `claimCollateral`.
- Min net debt 1,800 MUSD; 200 MUSD gas compensation added to debt.
- Fixed simple interest per trove, set at open; `refinance` moves to the current rate.
- Inserting/reinserting a trove needs `_upperHint/_lowerHint` from
  `HintHelpers.getApproxHint` + `SortedTroves.findInsertPosition`.
- Contracts are upgradeable on Mezo's side → pin and recheck ABIs before each deploy.
- `openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable`, with no
  max-fee parameter (confirmed in the deployed bytecode, T0.4).
- PriceFeed reads a Mezo **precompile** oracle at `0x7b7c…0015` and reverts if its price is
  older than 60s. Forge forks can't execute it → fork tests mock only that address (T0.4).
- Mezo's own deployed contracts use `PUSH0` (shanghai+); we still deploy london until T0.6.
- `minNetDebt` and the borrowing rate are governable → read them at runtime, never hard-code.
- Proven (T0.5): a contract can own a trove. No EOA checks; BTC returns via plain `call` with full
  gas to the contract's `receive()`. `repayMUSD`/`closeTrove` burn MUSD from the caller (no approve).
- Closing needs `debt − 200` MUSD, which exceeds what was borrowed (fee + interest): the vault must
  receive extra MUSD from its owner to close.
- Mezo's public RPC is flaky (dropped TLS, spurious nulls): retry reads; never blind-retry sends.
- `repayMUSD` reverts if net debt would fall below `minNetDebt` (1,800). So a rescue can repay at
  most `net debt − minNetDebt`; a trove at the minimum debt cannot be rescued by repayment
  (fork-tested, T1.3). RescueMarket must cap the repay accordingly (T1.6).

## 4. Invariants (enforced by tests)
1. A vault's trove is only mutated by its owner or by RescueMarket via `applyRescue` /
   `seizeForLien`.
2. While `lien.active`, the vault's collateral cannot leave except via `seizeForLien`.
3. `lien.amount ≤ maxRescue + fee + tip`, with `maxRescue` as set when the rescue runs.
4. A rescue never leaves ICR below the pre-rescue ICR (and never above the target).
5. Market accounting: `sum(shares value) == MUSD balance + outstanding liens + BTC held
   (valued at price)`, minus realised losses.
6. No external call before state updates (Checks-Effects-Interactions); every
   state-changing external function is `nonReentrant`.
7. `rescue` cannot be called twice on the same lien.

## 5. Known risks to design around
- **Seizure can fail**: `withdrawColl` reverts if it pushes ICR < 110% or system TCR < 150%.
  Seize the max allowed; leave remainder as a claim; handle Recovery Mode explicitly.
- **Rescued vault still liquidated**: providers lose the lien. Price this in the pricer.
- **Redemption against vault**: debt falls with collateral; lien stays on the remainder.
- **Price manipulation**: Mezo's PriceFeed is the only price source; do not add a second
  manipulable one.
- **Keeper liveness**: anyone can call `rescue`; the tip makes it profitable.
- **Small troves are unrescuable**: repay can't go below `minNetDebt`, so troves near 1,800 MUSD
  net debt have little or no rescue headroom. Surface this in the UI at opt-in (T1.3 finding).

## 6. Stack
| Layer | Choice | Why |
|---|---|---|
| Contracts | Solidity ^0.8.24 compiled with 0.8.28, evm_version london, Foundry, OpenZeppelin (non-upgradeable), PRBMath (Wave 2) | Fast tests, fuzz + invariant testing, fork testing |
| Chain | Mezo testnet (chain ID 31611), BTC as native gas and collateral | Required by the buildathon |
| Keeper | TypeScript, viem, Node 20+ | Small, matches frontend |
| Frontend | Next.js (App Router), TypeScript, Tailwind, shadcn/ui, wagmi + viem 2.x, Mezo Passport (RainbowKit) | Passport lets BTC wallets (Xverse, Unisat) and EVM wallets connect |
| Hosting | Vercel | Free, quick |
| Analysis | Slither, forge coverage | Required checks before merge |

Not used (from the original blueprint): Express/Socket.io, PostgreSQL/Prisma, The Graph,
Trigger.dev, Redux, TradingView, Chainlink, proxies, multi-chain. Add one only with a
recorded decision in `progress_tracker.md`.

## 7. Repo layout
```
lifeline/
├─ CLAUDE.md, AGENTS.md
├─ docs/
├─ contracts/                 # Foundry project
│  ├─ src/{VaultFactory,PositionVault,RescueMarket,FuzzyFeePricer}.sol
│  ├─ src/interfaces/         # IFeePricer + minimal MUSD interfaces (copied from deployed ABIs)
│  ├─ test/{unit,fuzz,invariant,fork}/
│  └─ script/Deploy.s.sol
├─ keeper/                    # TS keeper bot
├─ web/                       # Next.js app
└─ deployments/testnet.json   # our addresses + pinned MUSD addresses
```
