import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("product", "routes/product.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("favicon.ico", "routes/favicon[.]ico.tsx"),

  // auth (public)
  route("api/auth/*", "routes/api.auth.$.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("logout", "routes/logout.tsx"),
  route("invite/:token", "routes/invite.$token.tsx"),
  route("proposal/share", "routes/proposal.share.tsx"),
  route("report/share", "routes/report.share.tsx"),

  // authed, workspace not required yet
  route("onboarding", "routes/onboarding.tsx"),

  // operator-only: runs the scheduled monitoring path on demand. Inert unless
  // MONITORING_TRIGGER_TOKEN is configured. Not a user-facing page.
  route("internal/monitoring/run", "routes/internal.monitoring.run.tsx"),
  // operator-only: runs the MONITOR digest tick on demand. Inert unless
  // MONITOR_DIGEST_TRIGGER_TOKEN is configured. Not a user-facing page.
  route("internal/monitoring/digest", "routes/internal.monitoring.digest.tsx"),

  // authed + workspace required — each loader/action calls requireTenant itself
  route("changes", "routes/changes.tsx"),
  route("monitor", "routes/monitor.tsx"),
  route("operations", "routes/operations.tsx"),
  route("export/workspace", "routes/export.workspace.tsx"),
  route("opportunities", "routes/opportunities._index.tsx"),
  route("opportunities/:id", "routes/opportunities.$id.tsx"),
  route("reports/:id", "routes/reports.$id.tsx"),
  route("clients", "routes/clients._index.tsx"),
  route("clients/import", "routes/clients.import.tsx"),
  route("clients/:id/report", "routes/clients.$id.report.tsx"),
  route("clients/:id", "routes/clients.$id.tsx"),
  route("services", "routes/services._index.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
