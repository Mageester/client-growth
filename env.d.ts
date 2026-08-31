/// <reference types="vite/client" />

/**
 * The React Router server build is a virtual module supplied by the
 * `@react-router/dev` Vite plugin at build time. `react-router typegen` also
 * emits this in Phase E; this ambient declaration keeps `tsc` green until then.
 */
declare module "virtual:react-router/server-build" {
  import type { ServerBuild } from "react-router";
  const build: ServerBuild;
  export = build;
}
