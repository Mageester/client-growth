// src/core/allowlist.ts
function normalizeEmail(email3) {
  return email3.trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function parseAllowlist(raw) {
  if (typeof raw !== "string") return [];
  return raw.split(/[,\s]+/).map((entry2) => entry2.trim().toLowerCase()).filter((entry2) => entry2.length > 0);
}
__name(parseAllowlist, "parseAllowlist");
function splitAddress(email3) {
  const normalized3 = normalizeEmail(email3);
  const parts = normalized3.split("@");
  if (parts.length !== 2) return null;
  const [local, host] = parts;
  if (!local || !host) return null;
  return { local, domain: `@${host}` };
}
__name(splitAddress, "splitAddress");
function matchesAllowlist(allowlist, email3) {
  const address = splitAddress(email3);
  if (!address) return false;
  const normalized3 = `${address.local}${address.domain}`;
  return allowlist.some((entry2) => entry2 === normalized3 || entry2 === address.domain);
}
__name(matchesAllowlist, "matchesAllowlist");
