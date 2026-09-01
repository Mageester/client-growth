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
  useNavigation,
  useRouteLoaderData,
} from "react-router";

import "./styles/app.css";
import "./lib/context";
import { getWorkspaceForUser } from "@/db/workspaces";
import { EmptyState, getInitials, Icon, Menu } from "./components/ui";
import { d1Db } from "./lib/d1.server";
import { getSession } from "./lib/session.server";
import type { Route } from "./+types/root";

const EMPTY = { signedIn: false, workspaceName: null as string | null, email: null as string | null };

/** The brand mark, inline so the tab icon costs no request and never 404s. */
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2032%2032'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'8'%20fill%3D'%2317191f'%2F%3E%3Cg%20stroke%3D'%23fff'%20stroke-width%3D'2.8'%20stroke-linecap%3D'round'%20fill%3D'none'%3E%3Cpath%20d%3D'M10%2022.5v-6'%2F%3E%3Cpath%20d%3D'M16%2022.5v-11'%2F%3E%3Cpath%20d%3D'M22%2022.5v-14'%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E";

export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    const authed = await getSession(request, context);
    if (!authed) return EMPTY;
    const ws = await getWorkspaceForUser(
      d1Db(context.cloudflare.env.DB as never),
      authed.userId,
    );
    return { signedIn: true, workspaceName: ws?.name ?? null, email: authed.user.email };
  } catch {
    return EMPTY;
  }
}

const NAV = [
  { to: "/opportunities", label: "Opportunities" },
  { to: "/clients", label: "Clients" },
  { to: "/services", label: "Services" },
];

function BrandMark() {
  return (
    <span className="brand-mark">
      <Icon name="signal" size={14} strokeWidth={2.1} />
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  const navigation = useNavigation();
  const signedIn = data?.signedIn ?? false;
  const workspaceName = data?.workspaceName ?? null;
  const showAppNav = signedIn && Boolean(workspaceName) && location.pathname !== "/onboarding";
  const busy = navigation.state === "loading";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href={FAVICON} />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {busy && <div className="nav-progress" key={location.key} />}
        <header className="topbar">
          <div className="topbar-inner">
            <Link className="brand" to={signedIn ? "/opportunities" : "/"}>
              <BrandMark />
              <span className="brand-word">Client Growth</span>
            </Link>
            {showAppNav && (
              <>
                <span className="brand-rule" aria-hidden="true" />
                <nav className="topnav" aria-label="Primary">
                  {NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => (isActive ? "active" : undefined)}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
              </>
            )}
            <div className="topbar-end">
              {!signedIn && (
                <div className="public-nav">
                  <Link to="/login">Log in</Link>
                  <Link className="btn btn-primary btn-sm" to="/signup">
                    Create account
                  </Link>
                </div>
              )}
              {signedIn && (
                <Menu
                  align="end"
                  triggerClassName="ws-trigger"
                  triggerLabel="Workspace and account"
                  trigger={
                    <>
                      <span className="avatar">{getInitials(workspaceName)}</span>
                      <span className="ws-name">{workspaceName ?? "Set up workspace"}</span>
                      <Icon name="chevron-down" size={14} />
                    </>
                  }
                >
                  <div className="menu-head">
                    <strong>{workspaceName ?? "No workspace yet"}</strong>
                    <span>{data?.email ?? ""}</span>
                  </div>
                  <Link className="menu-item" to="/settings" role="menuitem">
                    <Icon name="settings" size={15} />
                    Settings
                  </Link>
                  <div className="menu-sep" />
                  <Form method="post" action="/logout" className="menu-form">
                    <button className="menu-item" type="submit" role="menuitem">
                      <Icon name="logout" size={15} />
                      Log out
                    </button>
                  </Form>
                </Menu>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="content">
          <div className="page-enter" key={location.pathname}>
            {children}
          </div>
        </main>
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
    <div className="error-page">
      <EmptyState
        icon="alert"
        title={title}
        actions={
          <Link className="btn" to="/">
            Back to Opportunities
          </Link>
        }
      >
        {String(detail)}
      </EmptyState>
    </div>
  );
}
