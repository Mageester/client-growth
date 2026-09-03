import { useEffect, useState, type ReactNode } from "react";
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
import "./styles/signal-desk.css";
import "./lib/context";
import { getWorkspaceForUser } from "@/db/workspaces";
import { AxiomCredit, EmptyState, getInitials, Icon, Menu } from "./components/ui";
import { d1Db } from "./lib/d1.server";
import { getSession } from "./lib/session.server";
import type { Route } from "./+types/root";

export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "client-growth-theme";

const EMPTY = {
  signedIn: false,
  workspaceName: null as string | null,
  email: null as string | null,
  theme: "system" as ThemePreference,
};

/** The brand mark, inline so the tab icon costs no request and never 404s. */
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2032%2032'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'8'%20fill%3D'%2314140f'%2F%3E%3Cg%20stroke%3D'%23f2f0ea'%20stroke-width%3D'2.8'%20stroke-linecap%3D'round'%20fill%3D'none'%3E%3Cpath%20d%3D'M10%2022.5v-6'%2F%3E%3Cpath%20d%3D'M16%2022.5v-11'%2F%3E%3Cpath%20d%3D'M22%2022.5v-14'%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E";

export function links() {
  return [
    { rel: "icon", href: FAVICON },
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      // Fraunces is Axiom's display face; `display=swap` keeps the fallback serif
      // painting immediately so a slow font never blocks first render.
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500;600&display=swap",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const rawTheme = request.headers
    .get("Cookie")
    ?.split("; ")
    .find((part) => part.startsWith(THEME_STORAGE_KEY + "="))
    ?.split("=")[1];
  const theme: ThemePreference =
    rawTheme === "light" || rawTheme === "dark" || rawTheme === "system"
      ? rawTheme
      : "system";
  try {
    const authed = await getSession(request, context);
    if (!authed) return { ...EMPTY, theme };
    const ws = await getWorkspaceForUser(
      d1Db(context.cloudflare.env.DB as never),
      authed.userId,
    );
    return { signedIn: true, workspaceName: ws?.name ?? null, email: authed.user.email, theme };
  } catch {
    return { ...EMPTY, theme };
  }
}

const NAV = [
  { to: "/opportunities", label: "Opportunities", icon: "inbox" as const },
  { to: "/clients", label: "Clients", icon: "users" as const },
  { to: "/services", label: "Services", icon: "briefcase" as const },
];

function BrandMark() {
  return (
    <span className="brand-mark">
      <Icon name="signal" size={14} strokeWidth={2.1} />
    </span>
  );
}

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): ThemePreference {
  let stored: string | null = null;
  try {
    stored = window.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Privacy-focused browser modes may disable storage entirely.
  }
  if (!stored) {
    stored =
      document.cookie
        .split("; ")
        .find((part) => part.startsWith(THEME_STORAGE_KEY + "="))
        ?.split("=")[1] ?? null;
  }
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function useThemePreference(initialTheme: ThemePreference) {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);

  useEffect(() => {
    const next = readStoredTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  function chooseTheme(next: ThemePreference) {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The cookie below preserves the choice when local storage is unavailable.
    }
    document.cookie = `${THEME_STORAGE_KEY}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return { theme, chooseTheme };
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const options: { value: ThemePreference; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  return (
    <div className="theme-picker" aria-label="Appearance">
      <span>Appearance</span>
      <div
        role="group"
        aria-label="Workspace theme"
        onClickCapture={(event) => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
            "button[data-theme-option]",
          );
          const next = button?.dataset.themeOption;
          if (next === "light" || next === "dark" || next === "system") onChange(next);
        }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-theme-option={option.value}
            aria-pressed={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppNavigation({ compact = false }: { compact?: boolean }) {
  return (
    <nav className={compact ? "app-nav app-nav-compact" : "app-nav"} aria-label="Primary">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          <Icon name={item.icon} size={18} strokeWidth={1.8} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function WorkspaceMenu({
  workspaceName,
  email,
  theme,
  onThemeChange,
  compact = false,
}: {
  workspaceName: string | null;
  email: string | null | undefined;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  compact?: boolean;
}) {
  return (
    <Menu
      align="end"
      triggerClassName={compact ? "ws-trigger ws-trigger-compact" : "ws-trigger"}
      triggerLabel="Workspace and account"
      trigger={
        <>
          <span className="avatar">{getInitials(workspaceName)}</span>
          {!compact && <span className="ws-name">{workspaceName ?? "Set up workspace"}</span>}
          <Icon name="chevron-down" size={14} />
        </>
      }
    >
      <div className="menu-head">
        <strong>{workspaceName ?? "No workspace yet"}</strong>
        <span>{email ?? ""}</span>
      </div>
      <Link className="menu-item" to="/settings" role="menuitem">
        <Icon name="settings" size={15} />
        Settings
      </Link>
      <ThemePicker value={theme} onChange={onThemeChange} />
      <div className="menu-sep" />
      <Form method="post" action="/logout" className="menu-form">
        <button className="menu-item" type="submit" role="menuitem">
          <Icon name="logout" size={15} />
          Log out
        </button>
      </Form>
      <div className="menu-sep" />
      <div className="menu-foot">
        <AxiomCredit />
      </div>
    </Menu>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  const navigation = useNavigation();
  const { theme, chooseTheme } = useThemePreference(data?.theme ?? "system");
  const signedIn = data?.signedIn ?? false;
  const workspaceName = data?.workspaceName ?? null;
  const showAppNav = signedIn && Boolean(workspaceName) && location.pathname !== "/onboarding";
  const busy = navigation.state === "loading";

  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {busy && <div className="nav-progress" key={location.key} />}
        {showAppNav ? (
          <div className="app-frame">
            <aside className="app-sidebar">
              <Link className="brand app-brand" to="/opportunities">
                <BrandMark />
                <span className="brand-word">Client Growth</span>
              </Link>
              <div className="app-sidebar-label">Revenue workspace</div>
              <AppNavigation />
              <div className="app-sidebar-spacer" />
              <WorkspaceMenu
                workspaceName={workspaceName}
                email={data?.email}
                theme={theme}
                onThemeChange={chooseTheme}
              />
            </aside>
            <header className="mobile-appbar">
              <Link className="brand" to="/opportunities" aria-label="Client Growth home">
                <BrandMark />
                <span className="brand-word">Client Growth</span>
              </Link>
              <AppNavigation compact />
              <WorkspaceMenu
                workspaceName={workspaceName}
                email={data?.email}
                theme={theme}
                onThemeChange={chooseTheme}
                compact
              />
            </header>
            <main id="main-content" className="content work-surface">
              <div className="page-enter" key={location.pathname}>
                {children}
              </div>
            </main>
          </div>
        ) : (
          <>
            <header className="topbar public-topbar">
              <div className="topbar-inner">
                <Link className="brand" to={signedIn ? "/opportunities" : "/"}>
                  <BrandMark />
                  <span className="brand-word">Client Growth</span>
                </Link>
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
                    <WorkspaceMenu
                      workspaceName={workspaceName}
                      email={data?.email}
                      theme={theme}
                      onThemeChange={chooseTheme}
                      compact
                    />
                  )}
                </div>
              </div>
            </header>
            <main id="main-content" className="content public-content">
              <div className="page-enter" key={location.pathname}>
                {children}
              </div>
            </main>
          </>
        )}
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
  const routeError = isRouteErrorResponse(error);
  const title = routeError ? `${error.status} ${error.statusText}` : "Something went wrong";
  const detail = routeError
    ? typeof error.data === "string" && error.data
      ? error.data
      : "That page could not be found."
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
  return (
    <div className="error-page">
      <EmptyState
        icon="alert"
        title={title}
        actions={
          <Link className="btn btn-primary" to="/opportunities">
            Back to Opportunities
          </Link>
        }
      >
        {String(detail)}
      </EmptyState>
    </div>
  );
}
