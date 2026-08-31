import { createRequestHandler } from "react-router";

/**
 * Cloudflare Worker entry. The domain engine in `src/` never imports this file
 * or anything Cloudflare-specific — the Worker is only a delivery mechanism.
 * Data loading, D1 access, and provider wiring land here in Phase D/E.
 */
declare global {
  interface CloudflareEnvironment {
    DB: D1Database;
    AI_PROVIDER?: string;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_BASE_URL?: string;
    DEEPSEEK_MODEL?: string;
    MAX_AI_CALLS_PER_RUN?: string;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
