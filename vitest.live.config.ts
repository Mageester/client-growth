import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * LIVE test run. Not part of `pnpm test`.
 * These tests are allowed to make real, paid provider calls and real network
 * requests. Run explicitly with `pnpm eval:live` after setting, e.g.:
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-...  pnpm eval:live
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/live/**/*.live.ts"],
  },
});
