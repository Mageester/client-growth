import { Link } from "react-router";

import { useCurrentSection } from "../lib/use-current-section";
import { Icon, type IconName } from "./ui";

/**
 * The secondary navigation for everything that is configuration rather than
 * work. Keeping these here is what lets the primary sidebar stay at four
 * destinations.
 *
 * Every label names the place it actually goes. Two did not: "Billing · Plans
 * and payments" scrolled to the account-email section of a product that has no
 * billing and no schema for it, and "Integrations · Connected tools" scrolled
 * to monitoring, where there are no connected tools. An owner who clicks
 * Billing to check what they are paying and lands on their email address
 * learns the navigation is decorative — and stops trusting the entries that
 * were telling the truth.
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
    description: "Automated client rechecks",
    icon: "refresh",
    section: "monitoring",
  },
  {
    key: "services",
    to: "/services",
    label: "Services",
    description: "Agency service catalog",
    icon: "briefcase",
    page: "services",
  },
  {
    key: "health",
    to: "/operations",
    label: "Data and health",
    description: "Export and analysis reliability",
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
    label: "Account",
    description: "Email and account access",
    icon: "settings",
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
