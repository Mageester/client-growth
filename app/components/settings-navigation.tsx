import { Link } from "react-router";

import { useCurrentSection } from "../lib/use-current-section";
import { Icon, type IconName } from "./ui";

/**
 * The secondary navigation for everything that is configuration rather than
 * work: the workspace, the service catalog, monitoring, the team, billing, and
 * the reliability of the checks themselves. Keeping these here is what lets the
 * primary sidebar stay focused on the main work destinations.
 *
 * Three of these are sections of the Settings page rather than separate routes.
 * The highlight follows the section actually on screen, so it never claims you
 * are somewhere you are not.
 */
type SettingsPage = "general" | "services" | "health";

const SETTINGS_LINKS: Array<{
  key: string;
  to: string;
  label: string;
  description: string;
  icon: IconName;
  /** Set when the entry is a section of the Settings page rather than a route. */
  section?: string;
  page?: SettingsPage;
}> = [
  {
    key: "general",
    to: "/settings",
    label: "General",
    description: "Workspace settings",
    icon: "settings",
    page: "general",
    section: "general",
  },
  {
    key: "monitoring",
    to: "/settings#monitoring",
    label: "Monitoring",
    description: "Schedule and digest",
    icon: "link",
    section: "monitoring",
  },
  {
    key: "services",
    to: "/services",
    label: "Services",
    description: "Manage service offerings",
    icon: "briefcase",
    page: "services",
  },
  {
    key: "health",
    to: "/operations",
    label: "Check health",
    description: "Analysis reliability",
    icon: "shield",
    page: "health",
  },
  {
    key: "team",
    to: "/settings#team",
    label: "Team",
    description: "Users and permissions",
    icon: "users",
    section: "team",
  },
  {
    key: "account",
    to: "/settings#account",
    label: "Account & pilot",
    description: "Access and account status",
    icon: "document",
    section: "account",
  },
];

const SECTION_IDS = SETTINGS_LINKS.map((item) => item.section).filter(
  (id): id is string => typeof id === "string",
);

export function SettingsNavigation({ active }: { active: SettingsPage }) {
  const section = useCurrentSection(SECTION_IDS, active === "general");

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SETTINGS_LINKS.map((item) => {
        const current =
          active === "general"
            ? item.section === (section ?? "general")
            : item.page === active;
        return (
          /* A plain Link, not a NavLink: three of these entries share the
           * /settings path, and NavLink's path-only match would light every
           * one of them. Which entry is current is decided above. */
          <Link
            key={item.key}
            to={item.to}
            aria-current={current ? "page" : undefined}
            className={current ? "active" : undefined}
          >
            <Icon name={item.icon} size={22} strokeWidth={1.6} />
            <span>
              <b>{item.label}</b>
              <small>{item.description}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
