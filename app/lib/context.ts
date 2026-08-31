import type { SqlDb } from "@/db/sql";
import { d1Db } from "./d1.server";

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnvironment;
      ctx: ExecutionContext;
    };
  }
}

export function getDb(context: { cloudflare: { env: CloudflareEnvironment } }): SqlDb {
  const binding = context.cloudflare?.env?.DB;
  if (!binding) {
    throw new Error(
      "D1 binding 'DB' is not available. Run `pnpm db:migrate:local` and start via the Cloudflare dev server.",
    );
  }
  return d1Db(binding as never);
}

export function rawEnv(context: {
  cloudflare: { env: CloudflareEnvironment };
}): Record<string, unknown> {
  return context.cloudflare.env as unknown as Record<string, unknown>;
}
