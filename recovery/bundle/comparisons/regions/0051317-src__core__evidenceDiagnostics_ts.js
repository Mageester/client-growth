// src/core/evidenceDiagnostics.ts
function inferCode(reason) {
  const text = reason.toLowerCase();
  if (text.includes("timeout")) return "timeout";
  if (text.includes("robots")) return "robots";
  if (text.includes("content type")) return "content-type";
  if (text.includes("content-length") || text.includes("body exceeds")) return "response-size";
  if (text.includes("javascript") || text.includes("client-rendered") || text.includes("js shell")) {
    return "js-shell";
  }
  if (text.includes("redirect")) return "redirect";
  if (text.includes("budget")) return "request-budget";
  if (text.includes("http ")) return "http-status";
  if (text.includes("policy") || text.includes("destination") || text.includes("scheme")) {
    return "policy";
  }
  if (text.includes("network") || text.includes("fetch")) return "network";
  return "unknown";
}
__name(inferCode, "inferCode");
function copyFor(code, stage) {
  switch (code) {
    case "timeout":
      return {
        title: "The site did not respond to Orbit's request",
        detail: "The site did not respond to Orbit's request within the time limit. Its server or network path did not return a response, so nothing was concluded from this incomplete read. Try again later; if it keeps happening, ask the site's host whether automated requests from Cloudflare are being delayed or blocked.",
        retryable: true
      };
    case "network":
      return {
        title: "Orbit could not connect to the site",
        detail: "The request failed before Orbit received a usable response. Nothing was concluded from this incomplete read. Check the domain and try again.",
        retryable: true
      };
    case "robots":
      return {
        title: "The site's crawler instructions limited the read",
        detail: "The site's robots.txt instructions prevented Orbit from reading the pages needed for this check. Nothing was concluded from the unreadable pages.",
        retryable: false,
        resolution: "Orbit obeys robots.txt, so reading again changes nothing on its own. The site's owner would need to allow AxiomOrbitBot in the site's robots.txt before Orbit can read these pages."
      };
    case "content-type":
      return {
        title: "The site returned content Orbit cannot read as a page",
        detail: "Orbit received a response, but it was not HTML or XHTML. Nothing was concluded from that response.",
        retryable: true
      };
    case "response-size":
      return {
        title: "The site's response was too large to read safely",
        detail: "Orbit stopped before parsing an oversized response. Nothing was concluded from that page.",
        retryable: true
      };
    case "redirect":
      return {
        title: "The site's redirect could not be followed safely",
        detail: "Orbit stopped at a redirect outside the allowed site boundary or without enough information to validate it. Nothing was concluded from the incomplete read.",
        retryable: true
      };
    case "policy":
      return {
        title: "Orbit refused an unsafe site address",
        detail: "The address or redirect did not meet Orbit's public-site safety policy (network policy). Nothing was fetched and no finding was created.",
        retryable: false,
        resolution: "Reading again would be refused the same way. Correct this client's domain, or ask the site's owner about the redirect, before trying a read."
      };
    case "http-status":
      return {
        title: "The site returned an error response",
        detail: "Orbit received an HTTP error instead of a readable page. Nothing was concluded from that response.",
        retryable: true
      };
    case "request-budget":
      return {
        title: "The site read reached Orbit's request limit",
        detail: "The read stopped before enough evidence was available. Nothing was concluded from the incomplete crawl.",
        retryable: true
      };
    case "response-body":
      return {
        title: "The site's response could not be read",
        detail: "Orbit received a response but could not read its body completely. Nothing was concluded from that incomplete page.",
        retryable: true
      };
    case "js-shell":
      return {
        title: "The site needs JavaScript to show its pages",
        detail: "Orbit received the site's page shell, but the service content was not present in the HTML it could safely read. Nothing was concluded from that incomplete read. The site needs server-rendered page content or a supported rendering connection before Orbit can analyze it.",
        retryable: false,
        resolution: "The same shell would come back on a second read. The site has to serve its page content in HTML before Orbit can analyze it."
      };
    case "aborted":
      return {
        title: "The site read was stopped before it finished",
        detail: "No finding was created from the incomplete read. Try again when the site is available.",
        retryable: true
      };
    default:
      return {
        title: "No page could be read",
        detail: stage === "unknown" ? "Orbit could not establish readable evidence from this site, so the analysis remains inconclusive." : "Orbit could not establish enough readable evidence from this part of the site, so the analysis remains inconclusive.",
        retryable: true
      };
  }
}
__name(copyFor, "copyFor");
function summarizeEvidenceFailure(evidence) {
  const first = evidence.networkEvents.find((event) => event.code === "js-shell") ?? evidence.networkEvents[0];
  const code = first?.code ?? (first ? inferCode(first.reason) : "unknown");
  const stage = first?.stage ?? "unknown";
  if (code === "redirect" && first && /redirect leaves the allowed (?:same-site|same-origin) boundary/i.test(
    first.reason
  )) {
    let redirectHost = "another domain";
    try {
      redirectHost = new URL(first.url).hostname;
    } catch {
    }
    return {
      code,
      stage,
      title: "The website address redirects to another domain",
      detail: `The saved website address redirects to ${redirectHost}, outside this client's approved site boundary. Orbit did not follow it or conclude anything from the destination.`,
      retryable: false,
      resolution: "Verify that the destination belongs to this business. If the business moved, update the client's website address and then run a new analysis."
    };
  }
  return { code, stage, ...copyFor(code, stage) };
}
__name(summarizeEvidenceFailure, "summarizeEvidenceFailure");
