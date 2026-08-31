import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Default test run: pure-domain + adapter tests in a plain Node environment.
 * No Cloudflare, no React, no network. `test/live/**` is excluded here and is
 * only run explicitly via `pnpm eval:live` (which makes real, paid calls).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/live/**", "node_modules/**", "dist/**", ".react-router/**"],
  },
});
