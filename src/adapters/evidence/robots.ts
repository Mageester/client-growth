/**
 * robots.txt, parsed and applied per RFC 9309.
 *
 * Why a crawler that only ever visits the agency's own clients honours this at
 * all: consent to look after a website is not consent from the people running
 * the servers in front of it, an unidentified bot that ignores the file is how
 * an IP range gets blocked, and a rule this product cannot see is a rule it
 * would break silently. The cost is one request per crawl.
 *
 * What matters more than the blocking is the accounting. A page we were asked
 * not to read is NOT a page that is missing, empty, or clean — it is a page we
 * did not read. The crawler records it as a blocked network event so the
 * analysis outcome stays "we could not look" rather than turning into a claim
 * about the site. That distinction is the product.
 *
 * Pure: parsing and matching only. Fetching belongs to the caller.
 */

export interface RobotsRule {
  /** The path pattern as written, after normalization. */
  pattern: string;
  allow: boolean;
}

export interface RobotsPolicy {
  /** Rules that apply to the user agent this policy was built for. */
  rules: readonly RobotsRule[];
  /** True when no group matched, so nothing is restricted. */
  unrestricted: boolean;
}

export const ALLOW_ALL: RobotsPolicy = { rules: [], unrestricted: true };

/** The token a user-agent line must contain to match ours, lowercased. */
function agentToken(userAgent: string): string {
  const product = userAgent.trim().split(/[\s/]+/, 1)[0] ?? "";
  return product.toLowerCase();
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  // Consecutive user-agent lines share one group; the first rule line closes
  // the agent list, and the next user-agent line after that starts a new group.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]!.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !acceptingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        acceptingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    if (!current) continue;
    acceptingAgents = false;
    // "Disallow:" with an empty value imposes no restriction at all. An empty
    // "Allow:" is meaningless in the same way; both are dropped rather than
    // treated as a rule matching every path.
    if (value === "") continue;
    current.rules.push({ pattern: value, allow: field === "allow" });
  }

  return groups;
}

/**
 * Build the policy that applies to one user agent.
 *
 * Specific groups win over `*` entirely — a crawler named in the file uses that
 * group's rules and ignores the wildcard group, even when the wildcard group is
 * stricter. That is what the specification requires, and treating it as "most
 * restrictive wins" would silently disobey an operator who deliberately gave
 * this crawler more access than the default.
 */
export function policyFor(text: string, userAgent: string): RobotsPolicy {
  const groups = parseGroups(text);
  if (groups.length === 0) return ALLOW_ALL;

  const token = agentToken(userAgent);
  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && token.length > 0 && agent === token),
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const applicable = named.length > 0 ? named : wildcard;
  if (applicable.length === 0) return ALLOW_ALL;

  return {
    rules: applicable.flatMap((group) => group.rules),
    unrestricted: false,
  };
}

/** Does `pattern` (with `*` and a trailing `$`) match this path? */
function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const segments = body.split("*");

  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment === "") continue;
    if (i === 0) {
      if (!path.startsWith(segment)) return false;
      index = segment.length;
      continue;
    }
    const found = path.indexOf(segment, index);
    if (found === -1) return false;
    index = found + segment.length;
  }

  if (!anchored) return true;
  // A trailing "$" anchors the end. With no wildcards the whole path must equal
  // the pattern; with them, the last segment must land exactly at the end.
  const last = segments[segments.length - 1]!;
  return last === "" ? index === path.length : path.endsWith(last) && index === path.length;
}

/**
 * Whether this policy permits fetching `path` (path + query, no origin).
 *
 * Longest matching pattern wins; a tie goes to Allow, per RFC 9309. So an
 * explicit `Allow: /services/` beats a broad `Disallow: /`.
 */
export function isAllowed(policy: RobotsPolicy, path: string): boolean {
  if (policy.unrestricted || policy.rules.length === 0) return true;
  const target = path.startsWith("/") ? path : `/${path}`;

  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!patternMatches(rule.pattern, target)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }

  return best ? best.allow : true;
}

/** The path+query a robots rule is matched against. */
export function robotsPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}
