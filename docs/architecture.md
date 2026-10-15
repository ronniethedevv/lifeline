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

### PositionVault
Owns exactly one MUSD trove. Holds BTC (native) and MUSD while passing them through.
- Owner functions: `open(debt, hints)` payable, `addColl` payable, `withdrawColl`,
  `borrow`, `repay`, `close`, `refinance`, `setRescueTerms(trigger, target, maxRescue)`,
  `optIn()/optOut()`.
- Market-only functions: `applyRescue(amount, fee, deadline)`, `seizeForLien(btcAmount)`.
- Lien state: `{ amount, dueBy, active }` (amount includes fee).
- Rules:
  - While a lien is active: `withdrawColl` and `close` revert unless the lien is repaid in
    the same call; `borrow` reverts.
  - `optOut()` reverts while a lien is active.
  - `seizeForLien` only after `dueBy`, only up to lien value + penalty at current price.
- Forwards BTC received from MUSD (withdrawals, surplus claims) to owner, except during
  seizure.

### RescueMarket
- Providers: `deposit(musd)` → shares; `withdraw(shares)` → MUSD + accrued fees (pro rata,
  ERC-4626-style share math, no external token needed in Wave 1).
- `rescue(vault)` (anyone):
  1. Check vault opted in, no active lien, ICR < trigger.
  2. Compute repay amount to reach target ICR, capped by `maxRescue` and pool liquidity.
  3. Get fee from FuzzyFeePricer.
  4. Transfer MUSD to vault, call `vault.applyRescue`, pay keeper tip.
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

## 4. Invariants (enforced by tests)
1. A vault's trove is only mutated by its owner or by RescueMarket via `applyRescue` /
   `seizeForLien`.
2. While `lien.active`, the vault's collateral cannot leave except via `seizeForLien`.
3. `lien.amount ≤ maxRescue + fee` set by the borrower at opt-in time.
4. A rescue never leaves ICR below the pre-rescue ICR.
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
