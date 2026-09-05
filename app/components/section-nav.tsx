import { useMemo } from "react";

import { useCurrentSection } from "../lib/use-current-section";
import { Icon, type IconName } from "./ui";

export interface SectionNavItem {
  id: string;
  label: string;
  icon: IconName;
  count?: number;
}

/**
 * The tab strip on the opportunity workspace.
 *
 * The sections are all on the page — the strip is a way to get to one and,
 * more importantly, a way to know which one you are reading. So the indicator
 * is driven by what is actually on screen rather than pinned to the first tab:
 * an indicator that never moves is a label that lies. Clicking still does what
 * an in-page link does, and the browser's own fragment navigation keeps
 * working with scripting off.
 */
export function SectionNav({
  items,
  label,
}: {
  items: SectionNavItem[];
  label: string;
}) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const active = useCurrentSection(ids);

  return (
    <nav className="detail-tabs" aria-label={label}>
      {items.map((item) => (
        <a
          key={item.id}
          href={"#" + item.id}
          aria-current={item.id === active ? "true" : undefined}
        >
          <Icon name={item.icon} size={20} strokeWidth={1.6} />
          {item.label}
          {typeof item.count === "number" && item.count > 0 && (
            <span className="tab-count">{item.count}</span>
          )}
        </a>
      ))}
    </nav>
  );
}
