# Setup

Network details below come from Mezo's developer docs. MUSD testnet addresses + ABIs are
pinned in `deployments/testnet.json` (T0.3). Still unconfirmed: the deployed `openTrove`
signature (T0.4).

## Prerequisites
- Node 20+, pnpm
- Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Slither: `pipx install slither-analyzer` (or `pip install slither-analyzer`)
- A fresh testnet-only wallet (never reuse a wallet holding real funds)

## Mezo testnet
- Chain ID: 31611 · native currency BTC, 18 decimals
- RPC (HTTPS): https://rpc.test.mezo.org
- RPC (WSS): wss://rpc-ws.test.mezo.org
- Explorer: https://explorer.test.mezo.org
- Testnet BTC: official Mezo Faucet (CAPTCHA-protected, so fund wallets by hand)
- Mezo's docs set Solidity 0.8.28 with `evmVersion: "london"` for testnet
- MUSD contract addresses: from `mezo-org/musd` → `solidity/artifacts/deployments/matsnet/`
  (matsnet = testnet; ignore `matsnet_fuzz`), cross-checked against the testnet column of
  <https://mezo.org/docs/developers/musd/musd-redemptions>. The "Contracts and Token
  Addresses" page lists only MUSD for testnet. Pinned in `deployments/testnet.json`.

## Contracts
```bash
mkdir contracts && cd contracts
forge init --empty --no-git .          # Forge 1.x: no --no-commit (not committing is the default)
rm -rf lib/forge-std                   # init clones it untracked; reinstall as pinned submodules:
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0
# Wave 2 only (GN pricer): forge install PaulRBerg/prb-math  + add the @prb/math/ remapping
```

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
evm_version = "london"  # per Mezo docs; T0.6 confirms with a real deploy
optimizer = true
optimizer_runs = 200
fuzz = { runs = 1000 }
invariant = { runs = 256, depth = 50 }

[rpc_endpoints]
mezo_testnet = "${MEZO_TESTNET_RPC}"
```

`contracts/remappings.txt`:
```
@openzeppelin/=lib/openzeppelin-contracts/
forge-std/=lib/forge-std/src/
```

`contracts/.env` (git-ignored; copy from the committed `contracts/.env.example`):
```
MEZO_TESTNET_RPC=https://rpc.test.mezo.org
DEPLOYER_PRIVATE_KEY=
```

Common commands:
```bash
forge build
forge test
FOUNDRY_PROFILE=fork forge test   # fork tests (shanghai + oracle mock); export .env first: set -a; . ./.env; set +a
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast
slither .
```

## Keeper
```bash
mkdir keeper && cd keeper
pnpm init && pnpm add viem dotenv && pnpm add -D typescript tsx @types/node
npx tsc --init --strict
```
`keeper/.env`: `MEZO_TESTNET_RPC`, `KEEPER_PRIVATE_KEY`, `MARKET_ADDRESS`, `FACTORY_ADDRESS`.

## Web
```bash
pnpm create next-app web --ts --tailwind --app --eslint
cd web && pnpm add @mezo-org/passport @rainbow-me/rainbowkit wagmi viem@2.x @tanstack/react-query
npx shadcn@latest init
```

Mezo Passport is built on RainbowKit. Wrap the app with `WagmiProvider`
(`config={getConfig({ appName: "Lifeline" })}` from `@mezo-org/passport`),
`QueryClientProvider`, then `RainbowKitProvider initialChain={mezoTestnet}`.
In Next.js App Router this goes in a `"use client"` `providers.tsx` that
`app/layout.tsx` renders; Mezo's example is a plain React entry file.
Also import `@rainbow-me/rainbowkit/styles.css`.

`web/.env.local`: `NEXT_PUBLIC_RPC_URL=https://rpc.test.mezo.org`, `NEXT_PUBLIC_CHAIN_ID=31611`,
`NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_MARKET_ADDRESS`, `NEXT_PUBLIC_PRICER_ADDRESS`.

## .gitignore (repo root)
```
.env
.env.local
contracts/out/
contracts/cache/
contracts/broadcast/
node_modules/
.next/
```
