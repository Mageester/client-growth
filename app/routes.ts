import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("favicon.ico", "routes/favicon[.]ico.tsx"),

  // auth (public)
  route("api/auth/*", "routes/api.auth.$.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("logout", "routes/logout.tsx"),

  // authed, workspace not required yet
  route("onboarding", "routes/onboarding.tsx"),

  // authed + workspace required — each loader/action calls requireTenant itself
  route("opportunities", "routes/opportunities._index.tsx"),
  route("opportunities/:id", "routes/opportunities.$id.tsx"),
  route("clients", "routes/clients._index.tsx"),
  route("clients/:id", "routes/clients.$id.tsx"),
  route("services", "routes/services._index.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
