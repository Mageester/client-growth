/**
 * Stable, deterministic identity for a candidate/opportunity so that re-running
 * analysis reconciles against existing rows instead of creating duplicates.
 */
import { TECHNICAL_RULE_IDS } from "@/core/rules/technical";

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** FNV-1a 32-bit, hex. Sync and runtime-agnostic (no crypto import needed). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function dedupeKey(clientId: string, ruleId: string, subject: string): string {
  if ((TECHNICAL_RULE_IDS as readonly string[]).includes(ruleId)) {
    return technicalDedupeKey(clientId, ruleId);
  }
  const basis = `${clientId}::${ruleId}::${slug(subject)}`;
  return `${slug(ruleId)}__${slug(subject)}__${fnv1a(basis)}`;
}

/** One site-level row for each directly observed technical repair type. */
export function technicalDedupeKey(clientId: string, ruleId: string): string {
  return `technical::${clientId}::${ruleId}`;
}
