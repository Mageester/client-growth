import { Icon, type IconName } from "./ui";

/**
 * The small tile that stands in front of a client, an opportunity, or a
 * service in every list.
 *
 * Two rules keep these honest. A client's mark is its own initials, because a
 * portfolio of eight identical briefcases tells the reader nothing and the
 * initials are real data we already hold. An opportunity's or a service's mark
 * is the icon for the kind of work it is, so the same kind of gap always looks
 * the same across Home, the queue, the detail screen, and the catalog.
 *
 * The hue is derived from the client's domain, so a client keeps the same tint
 * everywhere without anyone choosing one. It is decoration with a job: telling
 * rows apart at a glance. Status never uses it.
 */

/** Stable small hash. Same input, same tint, on the server and the client. */
function hashOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Six restrained tints. They read as one family under the app's charcoal, and
 * none of them is the accent or a status colour, so a tinted mark can never be
 * mistaken for "needs attention".
 */
const MARK_TINTS = [
  "sky",
  "teal",
  "amber",
  "violet",
  "rose",
  "lime",
] as const;

export type MarkTint = (typeof MARK_TINTS)[number];

export function tintFor(seed: string): MarkTint {
  return MARK_TINTS[hashOf(seed) % MARK_TINTS.length] ?? "sky";
}

export function markInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return "?";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** Which glyph stands for which kind of gap. Every rule maps to exactly one. */
const RULE_ICONS: Record<string, { icon: IconName; tint: MarkTint }> = {
  "missing-service-page": { icon: "document", tint: "sky" },
  "no-service-pages": { icon: "document", tint: "sky" },
  "thin-service-page": { icon: "document", tint: "sky" },
  "broken-conversion-path": { icon: "route", tint: "amber" },
  "broken-internal-link": { icon: "link", tint: "amber" },
  "missing-title": { icon: "heading", tint: "violet" },
  "duplicate-title": { icon: "copy", tint: "violet" },
  "missing-h1": { icon: "heading", tint: "violet" },
  "missing-meta-description": { icon: "tag", tint: "teal" },
  "missing-structured-data": { icon: "sliders", tint: "teal" },
  "missing-image-alt": { icon: "image", tint: "rose" },
};

export function markForRule(ruleId: string): { icon: IconName; tint: MarkTint } {
  return RULE_ICONS[ruleId] ?? { icon: "document", tint: "sky" };
}

/**
 * Services are chosen by the agency, so they carry tags rather than rule ids.
 * The tag decides the glyph; an unrecognised tag still gets a sensible one.
 */
const TAG_ICONS: Record<string, { icon: IconName; tint: MarkTint }> = {
  "landing-page": { icon: "document", tint: "sky" },
  "service-pages-build": { icon: "document", tint: "sky" },
  "conversion-fix": { icon: "route", tint: "amber" },
  "link-fix": { icon: "link", tint: "amber" },
  "title-fix": { icon: "heading", tint: "violet" },
  "duplicate-title-fix": { icon: "copy", tint: "violet" },
  "heading-fix": { icon: "heading", tint: "violet" },
  "meta-description": { icon: "tag", tint: "teal" },
  "structured-data": { icon: "sliders", tint: "teal" },
  "image-alt": { icon: "image", tint: "rose" },
};

export function markForTags(tags: readonly string[] | undefined, seed: string) {
  for (const tag of tags ?? []) {
    const match = TAG_ICONS[tag];
    if (match) return match;
  }
  return { icon: "briefcase" as IconName, tint: tintFor(seed) };
}

export function ClientMark({
  name,
  seed,
  size = "md",
  className = "",
}: {
  name: string;
  seed: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={`entity-mark mark-${size} mark-monogram ${className}`.trim()}
      data-tint={tintFor(seed || name)}
      aria-hidden="true"
    >
      {markInitials(name)}
    </span>
  );
}

export function GlyphMark({
  icon,
  tint,
  size = "md",
  className = "",
}: {
  icon: IconName;
  tint: MarkTint;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const glyph = size === "lg" ? 26 : size === "sm" ? 18 : 22;
  return (
    <span
      className={`entity-mark mark-${size} ${className}`.trim()}
      data-tint={tint}
      aria-hidden="true"
    >
      <Icon name={icon} size={glyph} strokeWidth={1.6} />
    </span>
  );
}
