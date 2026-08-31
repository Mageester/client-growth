/**
 * Types the React Router load `context` the Worker passes in (workers/app.ts).
 * Protected routes never read the raw binding directly — they go through
 * requireTenant() in session.server.ts, which returns a workspace-scoped handle.
 */
declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnvironment;
      ctx: ExecutionContext;
    };
  }
}

export {};
