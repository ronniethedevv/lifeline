import { configDefaults, defineConfig } from "vitest/config";

const e2e = process.env.KEEPER_E2E === "1";

export default defineConfig({
  test: {
    // `pnpm test`: fast offline unit tests. `pnpm test:e2e`: anvil fork of Mezo testnet (slow).
    include: e2e ? ["test/e2e/**/*.e2e.test.ts"] : ["test/**/*.test.ts"],
    exclude: e2e ? configDefaults.exclude : [...configDefaults.exclude, "test/e2e/**"],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
  },
});
