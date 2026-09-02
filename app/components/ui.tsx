import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";
import { Link, useLocation } from "react-router";

import type { AnalysisOutcome } from "@/core/analysisOutcome";
import type { EvidenceCase } from "../lib/evidence";
import type { ClientState } from "../lib/portfolio";

export type IconName =
  | "alert"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up-right"
  | "briefcase"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "copy"
  | "document"
  | "external"
  | "globe"
  | "inbox"
  | "link"
  | "logout"
  | "pencil"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "shield"
  | "signal"
  | "sliders"
  | "tag"
  | "target"
  | "users"
  | "x";

const iconPaths: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  "arrow-up-right": (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
      <path d="M3 12h18" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15h1" />
    </>
  ),
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 1.9" />
    </>
  ),
  document: (
    <>
      <path d="M6 3.5h7.5L18 8v12.5H6z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9 12.5h6M9 16h4.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="m19.5 4.5-8 8" />
      <path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5Z" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h4l1.4 2.6h6.2l1.4-2.6h4" />
      <path d="M5.6 5h12.8l2.1 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-5.5z" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a3.6 3.6 0 0 0 5.2 0l2.6-2.7a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.5" />
      <path d="M13.5 10.5a3.6 3.6 0 0 0-5.2 0l-2.6 2.7a3.7 3.7 0 0 0 5.2 5.2l1.4-1.5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 20H6.5A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4H14" />
      <path d="M16.5 8.5 20 12l-3.5 3.5" />
      <path d="M20 12h-9.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M16.5 4.5 19.5 7.5 8.5 18.5 4.5 19.5l1-4z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.6-4L4 8.7" />
      <path d="M4 4.8v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4L20 15.3" />
      <path d="M20 19.2v-4h-4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4.4 4.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M19.4 14.9a1.6 1.6 0 0 0 .3 1.8l.1.1-1.9 1.9-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3h-2.6v-.3a1.6 1.6 0 0 0-2.7-1.1l-.1.1-1.9-1.9.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3v-2.6h.3a1.6 1.6 0 0 0 1.1-2.7l-.1-.1 1.9-1.9.1.1a1.6 1.6 0 0 0 2.7-1.1V3.4h2.6v.3a1.6 1.6 0 0 0 2.7 1.1l.1-.1 1.9 1.9-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3v2.6h-.3a1.6 1.6 0 0 0-1.5 1.1Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v6c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  signal: (
    <>
      <path d="M5 19v-5.5" />
      <path d="M12 19V9" />
      <path d="M19 19V5" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 6.5h14M5 12h14M5 17.5h14" />
      <circle cx="9.5" cy="6.5" r="1.9" />
      <circle cx="15" cy="12" r="1.9" />
      <circle cx="8" cy="17.5" r="1.9" />
    </>
  ),
  tag: (
    <>
      <path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H12l7.4 7.4a1.9 1.9 0 0 1 0 2.7l-5.3 5.3a1.9 1.9 0 0 1-2.7 0L4 12z" />
      <circle cx="8.4" cy="8.4" r="1.1" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 18.4V20" />
      <circle cx="10" cy="8" r="3.1" />
      <path d="M16.2 11a3 3 0 1 0-1.3-5.7M17.6 15.1A3.4 3.4 0 0 1 20 18.4V20" />
    </>
  ),
  x: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}

/**
 * Queue menu teardown after the browser has handled an activated item. This is
 * especially important for menu items that are submit buttons inside a Form:
 * unmounting them synchronously cancels their native submit action.
 */
export function deferMenuClose(onClose: () => void) {
  setTimeout(onClose, 0);
}

/**
 * A small popover anchored to its trigger. Closes on outside pointer, Escape,
 * navigation, and on any activation inside the panel.
 */
export function Menu({
  trigger,
  triggerClassName = "btn btn-sm",
  triggerLabel,
  align = "end",
  children,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.key]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={"menu-pop align-" + align}
          role="menu"
          // Let a nested Form submit before unmounting the clicked button.
          // Closing synchronously cancels the browser's default submit action.
          onClick={() => deferMenuClose(() => setOpen(false))}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Right-hand drawer used for focused create/edit work.
 *
 * Owns the full modal contract: Escape closes, focus moves inside on open and
 * returns to the trigger on close, Tab is trapped so keyboard users cannot walk
 * out of the dialog into inert page content, and the background does not scroll.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    function focusable(): HTMLElement[] {
      const root = panel.current;
      if (!root) return [];
      return [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null || element === document.activeElement);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const body = panel.current?.querySelector(".panel-body");
    const first = body?.querySelector<HTMLElement>(
      "input:not([type=hidden]), textarea, select, button",
    );
    first?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="panel-root">
      <button type="button" className="panel-scrim" aria-label="Close panel" onClick={onClose} />
      <aside
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={panel}
      >
        <header className="panel-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="panel-body">{children}</div>
      </aside>
    </div>
  );
}

/** Five-segment confidence read-out. Quiet by default, positive when strong. */
export function Meter({ value }: { value: number }) {
  const filled = Math.max(1, Math.min(5, Math.round(value * 5)));
  const tone = value >= 0.8 ? "high" : value >= 0.6 ? "mid" : "low";
  return (
    <span className={"meter tone-" + tone} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} className={"meter-seg" + (index < filled ? " on" : "")} />
      ))}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
  inset = false,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  inset?: boolean;
}) {
  return (
    <div className={"empty" + (inset ? " inset" : "")}>
      <span className="empty-mark">
        <Icon name={icon} size={18} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function getInitials(value: string | null | undefined): string {
  const words = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "CG";
  const first = words[0] ?? "";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words[words.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

export function formatCurrencyRange(min: number, max: number): string {
  return `$${min.toLocaleString()}–$${max.toLocaleString()}`;
}

/** Compact money for summary copy: 950 -> $950, 12400 -> $12.4k. */
export function formatCompact(value: number): string {
  if (value < 1000) return "$" + Math.round(value).toLocaleString();
  const thousands = value / 1000;
  const digits = thousands >= 100 ? 0 : thousands >= 10 ? 1 : 1;
  return "$" + thousands.toFixed(digits).replace(/\.0$/, "") + "k";
}

export function formatCompactRange(min: number, max: number): string {
  return formatCompact(min) + "–" + formatCompact(max);
}

/**
 * Relative time for recency ("3 hours ago"), which is what the reader actually
 * wants when scanning a portfolio. Falls back to an absolute date past a week,
 * where "23 days ago" stops being easier to read than the date itself.
 */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "never";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 0) return formatDate(value);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${pluralize(minutes, "minute", "minutes")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${pluralize(hours, "hour", "hours")} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ${pluralize(days, "day", "days")} ago`;
  return formatDate(value);
}

/**
 * A scheduled time, phrased forwards. `formatRelative` is past-tense by
 * construction ("2 hours ago"), which reads as nonsense for a next check that is
 * overdue — the honest phrasing there is "due now", because the scheduler picks
 * it up on its next tick.
 */
export function formatDue(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "not scheduled";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "not scheduled";
  const seconds = Math.round((time - now) / 1000);
  if (seconds <= 0) return "due now";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `in ${minutes} ${pluralize(minutes, "minute", "minutes")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${pluralize(hours, "hour", "hours")}`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `in ${days} ${pluralize(days, "day", "days")}`;
  return "on " + formatDate(value);
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "Not analyzed yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not analyzed yet";
  return date.toLocaleDateString(
    undefined,
    withTime
      ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/** Strip the scheme so evidence URLs read as paths, not addresses. */
export function shortUrl(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Product components
// ---------------------------------------------------------------------------

const STATE_TITLE: Record<ClientState, string> = {
  attention: "Needs attention",
  clean: "Analyzed — clean",
  inconclusive: "Could not be analyzed",
  never: "Not analyzed yet",
};

/** The portfolio's four client states, as one consistent visual token. */
export function StateDot({ state }: { state: ClientState }) {
  return (
    <span className={"state-dot " + state} title={STATE_TITLE[state]}>
      <span className={"dot" + (state === "never" ? " hollow" : "")} />
      <span className="sr-only">{STATE_TITLE[state]}</span>
    </span>
  );
}

const OUTCOME_TONE: Record<AnalysisOutcome, string> = {
  findings: "ok",
  clean: "ok",
  inconclusive: "warn",
};

const OUTCOME_ICON: Record<AnalysisOutcome, IconName> = {
  findings: "target",
  clean: "check",
  inconclusive: "alert",
};

const OUTCOME_TITLE: Record<AnalysisOutcome, string> = {
  findings: "Analysis complete",
  clean: "Analyzed — nothing to sell",
  inconclusive: "Analysis inconclusive",
};

/**
 * The result of one analysis run, stated honestly.
 *
 * "We read the site and found nothing" and "we could not read the site" are
 * different facts and must never share a presentation. The crawler fails closed;
 * this component is where that guarantee reaches the user.
 */
export function AnalysisBanner({
  outcome,
  summary,
  limitation,
  clientName,
  children,
}: {
  outcome: AnalysisOutcome;
  summary: string;
  limitation?: string | null;
  clientName?: string | null;
  children?: ReactNode;
}) {
  return (
    <div
      className={"runcard " + OUTCOME_TONE[outcome]}
      role={outcome === "inconclusive" ? "alert" : "status"}
    >
      <span className="runcard-mark">
        <Icon name={OUTCOME_ICON[outcome]} size={15} />
      </span>
      <div className="runcard-body">
        <p className="runcard-title">
          {OUTCOME_TITLE[outcome]}
          {clientName ? <span className="runcard-client"> · {clientName}</span> : null}
        </p>
        <p className="runcard-summary">{summary}</p>
        {limitation && <p className="runcard-limit">{limitation}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Compact provenance for a feed row: the strongest few items with readable
 * titles, and a count for the rest. Ten raw URLs in a list reads as clutter and
 * makes real evidence look like a log dump, so the detail page owns the full set.
 */
export function EvidenceStrip({ evidence, href }: { evidence: EvidenceCase; href: string }) {
  const shown = evidence.primary.slice(0, 2);
  const rest = evidence.primary.length - shown.length + evidence.secondary.length;
  if (shown.length === 0 && rest === 0) return null;

  return (
    <div className="evidence-strip">
      <span className="evidence-strip-label">
        <Icon name="shield" size={12} />
        Evidence
      </span>
      <ul className="evidence-chips">
        {shown.map((item) => (
          <li key={item.kind + (item.url ?? item.title)}>
            {item.url ? (
              <a className="chip" href={item.url} target="_blank" rel="noreferrer" title={item.url}>
                <Icon name="link" size={11} />
                <span>{item.title}</span>
              </a>
            ) : (
              <span className="chip is-static" title={item.note}>
                <span>{item.title}</span>
              </span>
            )}
          </li>
        ))}
        {rest > 0 && (
          <li>
            <Link className="chip is-more" to={href}>
              +{rest} more
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

/** A labelled fact in the detail header. */
export function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={"fact" + (wide ? " fact-wide" : "")}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Client Growth is an Axiom product. The credit uses Axiom's own wordmark, held
 * locally so the app never depends on getaxiom.ca at runtime.
 */
export function AxiomCredit({ className = "" }: { className?: string }) {
  return (
    <a
      className={"axiom-credit " + className}
      href="https://getaxiom.ca"
      target="_blank"
      rel="noreferrer"
    >
      <span>Built by</span>
      <img src="/axiom-logo.webp" alt="Axiom" width={240} height={63} loading="lazy" />
    </a>
  );
}

/**
 * Shown while an analysis request is in flight.
 *
 * The crawl runs inside one request, so there is no real progress to report.
 * Rather than fake a step-by-step bar, this states what the run is doing and
 * roughly how long it takes, and announces itself to assistive technology.
 */
export function AnalysisRunning({ clientName, domain }: { clientName: string; domain?: string }) {
  return (
    <div className="runcard running" role="status" aria-live="polite">
      <span className="runcard-mark">
        <Icon name="refresh" size={15} className="spin" />
      </span>
      <div className="runcard-body">
        <p className="runcard-title">Reading {clientName}</p>
        <p className="runcard-summary">
          Fetching pages from {domain ?? "the site"}, then checking every offering against what the
          site actually shows. This usually takes a few seconds.
        </p>
        <span className="runbar" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
