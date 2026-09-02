import { parseEnv } from "@/config/env";
import { d1Db } from "../lib/d1.server";
import { runMonitoringTick } from "../lib/monitoring.server";
import type { Route } from "./+types/internal.monitoring.run";

/**
 * Operator-only trigger for the scheduled monitoring path.
 *
 * This exists for one reason: to verify the canary without waiting for a cron
 * boundary. It calls `runMonitoringTick` — the exact function the Worker's
 * `scheduled` handler calls, with the same limits and the same due-client
 * selection. There is no test-only scheduler, so a green canary here is
 * evidence about production and not about a parallel implementation.
 *
 * Safety properties, in order of importance:
 *
 *   - The route is inert unless MONITORING_TRIGGER_TOKEN is configured as a
 *     secret. Unconfigured, it 404s exactly like a path that does not exist.
 *   - It processes only clients that are genuinely due. It cannot enable
 *     monitoring, cannot pick a client, and cannot raise a limit.
 *   - It respects the same claim, so firing it during a real tick is safe.
 *   - It returns counts only: no client data, no evidence, no provider output.
 */

const MIN_TOKEN_LENGTH = 32;

/** Compare digests, not strings: equal work regardless of where they differ. */
async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** GET is never a way to start unattended paid work. */
export function loader() {
  throw new Response("Not found", { status: 404 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Record<string, unknown>;
  const expected = typeof env.MONITORING_TRIGGER_TOKEN === "string"
    ? env.MONITORING_TRIGGER_TOKEN
    : "";

  // Not configured: the endpoint does not exist. A short or blank token is
  // treated as not configured rather than as a weak one.
  if (expected.trim().length < MIN_TOKEN_LENGTH) {
    throw new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  if (!(await tokensMatch(bearer(request), expected))) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const parsed = parseEnv(env);
  const result = await runMonitoringTick({
    db: d1Db(context.cloudflare.env.DB as never),
    env,
    limit: parsed.MONITORING_MAX_CLIENTS_PER_RUN,
  });

  return json(
    {
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      considered: result.considered,
      scanned: result.scanned,
      skipped: result.skipped,
      failed: result.failed,
      newFindings: result.newFindings,
      resolvedFindings: result.resolvedFindings,
      evaluatorCalls: result.evaluatorCalls,
      budgetExhausted: result.budgetExhausted,
      // Outcome per client, without naming the client. Enough to confirm the
      // canary ran and what it concluded; nothing an operator does not need.
      outcomes: result.clients.map((client) => client.outcome),
    },
    200,
  );
}
