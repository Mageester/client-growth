// src/adapters/evidence/robots.ts
var ALLOW_ALL = { rules: [], unrestricted: true };
function agentToken(userAgent) {
  const product2 = userAgent.trim().split(/[\s/]+/, 1)[0] ?? "";
  return product2.toLowerCase();
}
__name(agentToken, "agentToken");
function parseGroups(text) {
  const groups = [];
  let current = null;
  let acceptingAgents = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line2 = rawLine.split("#", 1)[0].trim();
    if (!line2) continue;
    const separator = line2.indexOf(":");
    if (separator <= 0) continue;
    const field = line2.slice(0, separator).trim().toLowerCase();
    const value = line2.slice(separator + 1).trim();
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
    if (value === "") continue;
    current.rules.push({ pattern: value, allow: field === "allow" });
  }
  return groups;
}
__name(parseGroups, "parseGroups");
function policyFor(text, userAgent) {
  const groups = parseGroups(text);
  if (groups.length === 0) return ALLOW_ALL;
  const token3 = agentToken(userAgent);
  const named = groups.filter(
    (group) => group.agents.some((agent) => agent !== "*" && token3.length > 0 && agent === token3)
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const applicable = named.length > 0 ? named : wildcard;
  if (applicable.length === 0) return ALLOW_ALL;
  return {
    rules: applicable.flatMap((group) => group.rules),
    unrestricted: false
  };
}
__name(policyFor, "policyFor");
function patternMatches(pattern2, path) {
  const anchored = pattern2.endsWith("$");
  const body = anchored ? pattern2.slice(0, -1) : pattern2;
  const segments = body.split("*");
  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
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
  const last = segments[segments.length - 1];
  return last === "" ? index === path.length : path.endsWith(last) && index === path.length;
}
__name(patternMatches, "patternMatches");
function isAllowed(policy3, path) {
  if (policy3.unrestricted || policy3.rules.length === 0) return true;
  const target = path.startsWith("/") ? path : `/${path}`;
  let best = null;
  for (const rule of policy3.rules) {
    if (!patternMatches(rule.pattern, target)) continue;
    if (!best || rule.pattern.length > best.pattern.length || rule.pattern.length === best.pattern.length && rule.allow && !best.allow) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
__name(isAllowed, "isAllowed");
function robotsPath(url) {
  return `${url.pathname}${url.search}`;
}
__name(robotsPath, "robotsPath");
