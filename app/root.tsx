import type { ReactNode } from "react";
import {
  Form,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router";

import "./styles/app.css";
import "./lib/context";
import { getWorkspaceForUser } from "@/db/workspaces";
import { d1Db } from "./lib/d1.server";
import { getSession } from "./lib/session.server";
import type { Route } from "./+types/root";

export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    const authed = await getSession(request, context);
    if (!authed) return { signedIn: false, workspaceName: null as string | null };
    const ws = await getWorkspaceForUser(
      d1Db(context.cloudflare.env.DB as never),
      authed.userId,
    );
    return { signedIn: true, workspaceName: ws?.name ?? null };
  } catch {
    return { signedIn: false, workspaceName: null as string | null };
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const signedIn = data?.signedIn ?? false;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <span className="brand">Client Growth</span>
            {signedIn && (
              <>
                <nav className="topnav">
                  <NavLink to="/opportunities">Opportunities</NavLink>
                  <NavLink to="/clients">Clients</NavLink>
                  <NavLink to="/services">Services</NavLink>
                  <NavLink to="/settings">Settings</NavLink>
                </nav>
                <span style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
                  {data?.workspaceName && <small>{data.workspaceName}</small>}
                  <Form method="post" action="/logout" className="inline">
                    <button className="subtle" type="submit">
                      Log out
                    </button>
                  </Form>
                </span>
              </>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong";
  const detail = isRouteErrorResponse(error)
    ? error.data
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <div className="card">
      <h1>{title}</h1>
      <p className="muted">{String(detail)}</p>
      <NavLink to="/">Home</NavLink>
    </div>
  );
}
