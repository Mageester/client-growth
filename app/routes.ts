import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("opportunities", "routes/opportunities._index.tsx"),
  route("opportunities/:id", "routes/opportunities.$id.tsx"),
  route("clients", "routes/clients._index.tsx"),
  route("clients/:id", "routes/clients.$id.tsx"),
  route("services", "routes/services._index.tsx"),
] satisfies RouteConfig;
