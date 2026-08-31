import type { ReactNode } from "react";
import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

import "./styles/app.css";
import type { Route } from "./+types/root";

export function Layout({ children }: { children: ReactNode }) {
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
            <nav className="topnav">
              <NavLink to="/opportunities">Opportunities</NavLink>
              <NavLink to="/clients">Clients</NavLink>
              <NavLink to="/services">Services</NavLink>
            </nav>
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
      <NavLink to="/opportunities">Back to opportunities</NavLink>
    </div>
  );
}
