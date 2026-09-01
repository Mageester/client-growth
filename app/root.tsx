import type { ReactNode } from "react";
import {
  Form,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useRouteLoaderData,
} from "react-router";

import "./styles/app.css";
import "./lib/context";
import { getWorkspaceForUser } from "@/db/workspaces";
import { getInitials, Icon } from "./components/ui";
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
  const location = useLocation();
  const signedIn = data?.signedIn ?? false;
  const showAppNav = signedIn && Boolean(data?.workspaceName) && location.pathname !== "/onboarding";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink className="brand" to={signedIn ? "/opportunities" : "/"}>
              <span className="brand-mark"><Icon name="signal" size={19} strokeWidth={2.2} /></span>
              <span>Client Growth</span>
            </NavLink>
            {showAppNav && (
              <nav className="topnav" aria-label="Primary navigation">
                <NavLink to="/opportunities" className={({ isActive }) => isActive ? "active" : undefined}>
                  <Icon name="activity" size={16} />
                  Opportunities
                </NavLink>
                <NavLink to="/clients" className={({ isActive }) => isActive ? "active" : undefined}>
                  <Icon name="users" size={16} />
                  Clients
                </NavLink>
                <NavLink to="/services" className={({ isActive }) => isActive ? "active" : undefined}>
                  <Icon name="briefcase" size={16} />
                  Services
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => isActive ? "active" : undefined}>
                  <Icon name="settings" size={16} />
                  Settings
                </NavLink>
              </nav>
            )}
            <div className="topbar-actions">
              {!signedIn && (
                <div className="public-nav">
                  <Link to="/login">Log in</Link>
                  <Link className="btn btn-primary btn-sm" to="/signup">Create account</Link>
                </div>
              )}
              {signedIn && (
                <div className="account-area">
                  <div className="workspace-control">
                    <span className="avatar avatar-small">{getInitials(data?.workspaceName)}</span>
                    <span className="workspace-copy">
                      <strong>{data?.workspaceName ?? "Set up workspace"}</strong>
                      <small>{data?.workspaceName ? "Workspace" : "Getting started"}</small>
                    </span>
                    <Icon name="chevron-down" size={15} />
                  </div>
                  <Form method="post" action="/logout" className="inline">
                    <button className="account-logout" type="submit">
                      Log out
                    </button>
                  </Form>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="content">{children}</main>
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
    <div className="error-state">
      <span className="empty-icon"><Icon name="x" size={20} /></span>
      <h1>{title}</h1>
      <p className="muted">{String(detail)}</p>
      <NavLink className="btn btn-secondary" to="/">Return home</NavLink>
    </div>
  );
}
