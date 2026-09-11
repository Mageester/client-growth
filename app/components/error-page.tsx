import { Link, isRouteErrorResponse } from "react-router";

import { Icon } from "./ui";

export type ErrorPageAction = {
  to: string;
  label: string;
  primary?: boolean;
};

export type ErrorPageView = {
  /** The document title. Empty titles are what make a stale link look broken. */
  title: string;
  heading: string;
  message: string;
  actions: ErrorPageAction[];
};

/**
 * What a failed page says, decided in one place.
 *
 * Two rules hold this together. First, nothing the framework or a thrown error
 * produced is ever shown: React Router's unmatched-route 404 arrives with
 * `data` set to `Error: No route matches URL "/…"`, and that string belongs in
 * a log, not in front of an agency's staff or their client. Second, the
 * recovery action is chosen from whether the visitor is signed in, because a
 * 404 on a public route that offers only a protected destination sends the
 * reader to /login from a page that just said the page does not exist.
 */
export function errorPageView(error: unknown, signedIn: boolean): ErrorPageView {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  const onward: ErrorPageAction = signedIn
    ? { to: "/opportunities", label: "Back to Opportunities" }
    : { to: "/login", label: "Log in" };

  return {
    title: missing ? "Page not found · Axiom Orbit" : "Something went wrong · Axiom Orbit",
    heading: missing ? "Page not found" : "Something went wrong",
    message: missing
      ? "This page does not exist, or the link that brought you here is out of date."
      : "An unexpected error stopped this page from loading. Try again in a moment.",
    actions: [{ to: "/", label: "Go to the homepage", primary: true }, onward],
  };
}

export function ErrorPage({ error, signedIn }: { error: unknown; signedIn: boolean }) {
  const view = errorPageView(error, signedIn);

  return (
    <div className="error-page">
      <span className="empty-mark">
        <Icon name="alert" size={18} />
      </span>
      <h1>{view.heading}</h1>
      <p>{view.message}</p>
      <div className="empty-actions">
        {view.actions.map((action) => (
          <Link
            key={action.to}
            className={action.primary ? "btn btn-primary" : "btn"}
            to={action.to}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
