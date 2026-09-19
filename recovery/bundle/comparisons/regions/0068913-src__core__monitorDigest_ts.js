// src/core/monitorDigest.ts
var DAY2 = 24 * 60 * 60 * 1e3;
var MONITOR_DIGEST_INTERVAL_MS = {
  off: 0,
  weekly: 7 * DAY2
};
var MONITOR_DIGEST_PERIOD_MS = 7 * DAY2;
var MONITOR_DIGEST_CLAIM_TTL_MS = 10 * 60 * 1e3;
function buildMonitorDigest(facts) {
  const lines = facts.clients.filter((c) => c.newCount > 0 || c.resolvedCount > 0).map((c) => ({
    clientId: c.clientId,
    clientName: c.clientName,
    domain: c.domain,
    headline: changeHeadline(c.latestOutcome ?? "clean", {
      newCount: c.newCount,
      stillOpenCount: 0,
      resolvedCount: c.resolvedCount
    }),
    newCount: c.newCount,
    resolvedCount: c.resolvedCount,
    openCount: c.openCount,
    priceRange: c.openCount > 0 ? { min: c.openPriceMin, max: c.openPriceMax } : null,
    topOpportunity: c.topOpportunity,
    payoff: c.topOpportunity ? paybackSentence(
      jobsToPayback({
        priceMin: c.topOpportunity.priceMin,
        priceMax: c.topOpportunity.priceMax,
        averageJobValue: c.averageJobValue ?? void 0
      })
    ) : null
  })).sort(
    (a, b) => b.newCount - a.newCount || (b.priceRange?.max ?? 0) - (a.priceRange?.max ?? 0) || a.clientName.localeCompare(b.clientName)
  );
  const newFindings = facts.clients.reduce((sum, c) => sum + c.newCount, 0);
  const resolvedFindings = facts.clients.reduce((sum, c) => sum + c.resolvedCount, 0);
  const priceMin = lines.reduce((sum, l) => sum + (l.priceRange?.min ?? 0), 0);
  const priceMax = lines.reduce((sum, l) => sum + (l.priceRange?.max ?? 0), 0);
  return {
    workspaceName: facts.workspaceName,
    period: facts.period,
    monitoredClients: facts.monitoredClients,
    totals: {
      newFindings,
      resolvedFindings,
      clientsWithChange: lines.length,
      monitoredClients: facts.monitoredClients,
      priceMin,
      priceMax
    },
    lines,
    couldNotRead: facts.clients.filter((c) => c.couldNotRead).length,
    quiet: newFindings === 0 && resolvedFindings === 0
  };
}
__name(buildMonitorDigest, "buildMonitorDigest");
function shouldSendDigest(model, settings2) {
  if (settings2.cadence === "off") return false;
  if (model.monitoredClients === 0) return false;
  if (settings2.onlyOnChange) return !model.quiet;
  return true;
}
__name(shouldSendDigest, "shouldSendDigest");
function plural(n, one, many) {
  return n === 1 ? one : many;
}
__name(plural, "plural");
function money(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
__name(money, "money");
function moneyRange(min, max) {
  return min === max ? money(min) : `${money(min)} \u2013 ${money(max)}`;
}
__name(moneyRange, "moneyRange");
function formatPeriod(period) {
  const start = new Date(period.since);
  const end = new Date(period.until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const fmt = /* @__PURE__ */ __name((d) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), "fmt");
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}
__name(formatPeriod, "formatPeriod");
function trimBase(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}
__name(trimBase, "trimBase");
function linksFor(baseUrl) {
  const base = trimBase(baseUrl);
  return {
    opportunity: /* @__PURE__ */ __name((id) => `${base}/opportunities/${id}`, "opportunity"),
    client: /* @__PURE__ */ __name((id) => `${base}/clients/${id}`, "client"),
    monitor: `${base}/monitor`
  };
}
__name(linksFor, "linksFor");
function digestSummarySentence(model) {
  const parts = [];
  if (model.totals.newFindings > 0) {
    const worth = model.totals.priceMax > 0 ? ` worth ${moneyRange(model.totals.priceMin, model.totals.priceMax)}` : "";
    parts.push(
      `${model.totals.newFindings} new ${plural(model.totals.newFindings, "opportunity", "opportunities")}${worth}`
    );
  }
  if (model.totals.resolvedFindings > 0) {
    parts.push(
      `${model.totals.resolvedFindings} ${plural(model.totals.resolvedFindings, "finding", "findings")} fixed by ${plural(model.totals.resolvedFindings, "a client", "clients")}`
    );
  }
  const body = parts.length > 0 ? parts.join(", ") : "no new billable work";
  return `This week across ${model.monitoredClients} monitored ${plural(model.monitoredClients, "client", "clients")}: ${body}.`;
}
__name(digestSummarySentence, "digestSummarySentence");
function digestSubject(model) {
  if (model.totals.newFindings > 0) {
    return `Axiom Orbit \u2014 ${model.totals.newFindings} new ${plural(model.totals.newFindings, "opportunity", "opportunities")} across your clients`;
  }
  if (model.totals.resolvedFindings > 0) {
    return `Axiom Orbit \u2014 ${model.totals.resolvedFindings} ${plural(model.totals.resolvedFindings, "finding", "findings")} your clients fixed this week`;
  }
  return "Axiom Orbit \u2014 your weekly monitoring digest";
}
__name(digestSubject, "digestSubject");
function couldNotReadSentence(model) {
  const n = model.couldNotRead;
  return `${n} ${plural(n, "site", "sites")} couldn't be fully read this week. Nothing was concluded for ${plural(n, "it", "them")}, and the next check is scheduled automatically.`;
}
__name(couldNotReadSentence, "couldNotReadSentence");
function renderMonitorDigestText(model, baseUrl) {
  const links2 = linksFor(baseUrl);
  const out = [];
  out.push(`${model.workspaceName} \u2014 monitoring digest`);
  const period = formatPeriod(model.period);
  if (period) out.push(period);
  out.push("");
  out.push(digestSummarySentence(model));
  for (const line2 of model.lines) {
    out.push("");
    out.push(`${line2.clientName} (${line2.domain})`);
    out.push(`  ${line2.headline}`);
    if (line2.topOpportunity) {
      const price = moneyRange(line2.topOpportunity.priceMin, line2.topOpportunity.priceMax);
      out.push(`  ${line2.topOpportunity.title} \u2014 ${price}${line2.payoff ? ` \xB7 ${line2.payoff}` : ""}`);
      out.push(`  ${links2.opportunity(line2.topOpportunity.id)}`);
    } else {
      out.push(`  ${links2.client(line2.clientId)}`);
    }
  }
  if (model.quiet) {
    out.push("");
    out.push("No new opportunities this week \u2014 everything open is unchanged.");
  }
  if (model.couldNotRead > 0) {
    out.push("");
    out.push(couldNotReadSentence(model));
  }
  out.push("");
  out.push(`Manage monitoring and digests: ${links2.monitor}`);
  out.push(
    "You're receiving this because monitoring is on for one or more of your clients in Axiom Orbit."
  );
  return out.join("\n");
}
__name(renderMonitorDigestText, "renderMonitorDigestText");
function escapeHtml2(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml2, "escapeHtml");
function renderMonitorDigestHtml(model, baseUrl) {
  const links2 = linksFor(baseUrl);
  const period = formatPeriod(model.period);
  const ink = "#1a1c1f";
  const faint = "#6b7076";
  const rule = "#e6e8eb";
  const rows = model.lines.map((line2) => {
    const price = line2.topOpportunity ? moneyRange(line2.topOpportunity.priceMin, line2.topOpportunity.priceMax) : line2.priceRange ? moneyRange(line2.priceRange.min, line2.priceRange.max) : "";
    const target = line2.topOpportunity ? links2.opportunity(line2.topOpportunity.id) : links2.client(line2.clientId);
    const title2 = line2.topOpportunity ? escapeHtml2(line2.topOpportunity.title) : "";
    const detail = title2 ? `<div style="margin-top:4px"><a href="${target}" style="color:${ink};font-weight:600;text-decoration:none">${title2}</a>${price ? ` <span style="color:${faint}">\u2014 ${price}</span>` : ""}${line2.payoff ? `<div style="color:${faint};font-size:13px">${escapeHtml2(line2.payoff)}</div>` : ""}</div>` : `<div style="margin-top:4px"><a href="${target}" style="color:${ink};text-decoration:none">View client</a></div>`;
    return `<tr><td style="padding:14px 0;border-bottom:1px solid ${rule}">
        <div style="font-weight:600;color:${ink}">${escapeHtml2(line2.clientName)} <span style="color:${faint};font-weight:400">${escapeHtml2(line2.domain)}</span></div>
        <div style="color:${faint};font-size:14px;margin-top:2px">${escapeHtml2(line2.headline)}</div>
        ${detail}
      </td></tr>`;
  }).join("\n");
  const quietBlock = model.quiet ? `<p style="color:${faint}">No new opportunities this week \u2014 everything open is unchanged.</p>` : "";
  const couldNotReadBlock = model.couldNotRead > 0 ? `<p style="color:${faint};font-size:13px">${escapeHtml2(couldNotReadSentence(model))}</p>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:${ink}">
  <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${faint}">Axiom Orbit \xB7 Monitor</div>
  <h1 style="font-size:20px;margin:6px 0 2px">${escapeHtml2(model.workspaceName)} \u2014 monitoring digest</h1>
  ${period ? `<div style="color:${faint};font-size:14px">${period}</div>` : ""}
  <p style="font-size:16px;margin:16px 0">${escapeHtml2(digestSummarySentence(model))}</p>
  ${rows ? `<table role="presentation" width="100%" style="border-collapse:collapse">${rows}</table>` : ""}
  ${quietBlock}
  ${couldNotReadBlock}
  <p style="margin-top:24px"><a href="${links2.monitor}" style="color:${ink};font-weight:600">Manage monitoring and digests \u2192</a></p>
  <p style="color:${faint};font-size:12px">You're receiving this because monitoring is on for one or more of your clients in Axiom Orbit.</p>
</div>`;
}
__name(renderMonitorDigestHtml, "renderMonitorDigestHtml");
