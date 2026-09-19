// src/core/analysisOutcome.ts
var ANALYSIS_OUTCOMES = ["findings", "clean", "inconclusive"];
function measureEvidenceReach(evidence) {
  const readablePages = evidence.site.pages.filter(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
  ).length;
  return {
    readablePages,
    fetchedPages: evidence.site.pages.length,
    blockedEvents: evidence.networkEvents.filter((e) => e.outcome === "blocked").length,
    inconclusiveEvents: evidence.networkEvents.filter((e) => e.outcome === "inconclusive").length
  };
}
__name(measureEvidenceReach, "measureEvidenceReach");
function joinSentences(parts) {
  const sentences = parts.map((part) => part?.trim()).filter((part) => Boolean(part)).map((part) => /[.!?]$/.test(part) ? part : `${part}.`);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
__name(joinSentences, "joinSentences");
function incompleteRunReasons(input, reach) {
  const limits = [];
  if (!input.analyzable) {
    limits.push(`Site-wide coverage was incomplete: ${input.coverageReason}`);
  }
  if (reach.inconclusiveEvents > 0) {
    limits.push(
      `${reach.inconclusiveEvents} ${reach.inconclusiveEvents === 1 ? "request" : "requests"} during this run could not be completed, so a small part of the site was not assessed.`
    );
  }
  if (input.evaluatorErrors > 0) {
    limits.push(
      `${input.evaluatorErrors} other ${input.evaluatorErrors === 1 ? "candidate could" : "candidates could"} not be assessed because the evaluator failed.`
    );
  }
  if (input.budgetSkipped) {
    limits.push(
      `${input.budgetSkipped} other potential ${input.budgetSkipped === 1 ? "project was" : "projects were"} not assessed because the AI limit was reached.`
    );
  }
  if (input.catalog.unmatchedLabels.length > 0) {
    limits.push(
      `Only ${input.catalog.matched} of ${input.catalog.total} kinds of gap were checked \u2014 no active service is offered for ${input.catalog.unmatchedLabels.map((label) => label.toLowerCase()).join(" or ")}.`
    );
  }
  if (input.catalog.adjacentLabels.length > 0) {
    limits.push(
      `${input.catalog.adjacentLabels.length} ${input.catalog.adjacentLabels.length === 1 ? "check used an adjacent catalog capability" : "checks used adjacent catalog capabilities"}; review service fit, scope and pricing before presenting that work.`
    );
  }
  return limits;
}
__name(incompleteRunReasons, "incompleteRunReasons");
function classifyAnalysis(input) {
  const reach = measureEvidenceReach(input.evidence);
  const visual = input.evidence.visualReview;
  if (!input.surfaced && input.budgetSkipped) return {
    outcome: "inconclusive",
    summary: "The review reached its AI limit before every candidate was checked.",
    limitation: `${input.budgetSkipped} potential ${input.budgetSkipped === 1 ? "project remains" : "projects remain"} unassessed. Existing work is preserved.`,
    reach
  };
  if (visual) {
    const limitation3 = joinSentences([...visual.limitations, ...incompleteRunReasons(input, reach)]);
    if (input.catalog.matched === 0) {
      return {
        outcome: "inconclusive",
        summary: "Diagnostics were collected, but no catalog-backed opportunities can be published because no service in your catalog is offered for a website gap.",
        limitation: joinSentences([
          limitation3,
          "No active service is offered for a website gap yet; add or edit a service, set what kind of gap it answers, then re-analyze to publish catalog-backed work."
        ]),
        publicationBlockReason: "no_matching_catalog_service",
        reach
      };
    }
    if (input.surfaced > 0) return { outcome: "findings", summary: `${input.surfaced} ${input.surfaced === 1 ? "project" : "projects"} worth reviewing.`, limitation: limitation3, reach };
    const coverageLimited = !input.analyzable && input.coverageLimitation !== "site-too-thin";
    if (visual.status !== "complete" || input.evaluatorErrors > 0 || coverageLimited || reach.readablePages === 0) return { outcome: "inconclusive", summary: "The review is incomplete. No priority project was established.", limitation: limitation3, reach };
    return { outcome: "clean", summary: "No substantial project was identified in the captured views.", limitation: limitation3, reach };
  }
  if (input.catalog.matched === 0) {
    return {
      outcome: "inconclusive",
      summary: "Diagnostics were collected, but no catalog-backed opportunities can be published because no service in your catalog is offered for a website gap.",
      limitation: "The diagnostic evidence is available for review. No active service is offered for a website gap yet; Axiom Orbit prices every opportunity from something you sell, so add or edit a service, set what kind of gap it answers, then re-analyze to publish catalog-backed work.",
      publicationBlockReason: "no_matching_catalog_service",
      reach
    };
  }
  if (input.surfaced > 0) {
    return {
      outcome: "findings",
      summary: input.surfaced === 1 ? "1 evidence-backed opportunity found." : `${input.surfaced} evidence-backed opportunities found.`,
      limitation: joinSentences(incompleteRunReasons(input, reach)),
      reach
    };
  }
  if (reach.readablePages === 0) {
    const diagnostic = input.evidence.networkEvents.length > 0 ? summarizeEvidenceFailure(input.evidence) : null;
    const blocked = reach.blockedEvents > 0 && reach.inconclusiveEvents === 0;
    return {
      outcome: "inconclusive",
      summary: blocked ? "The site could not be reached safely, so nothing was assessed." : "No readable pages were returned, so nothing was assessed.",
      limitation: diagnostic && diagnostic.code !== "unknown" ? diagnostic.detail : blocked ? "Requests to this domain were refused by the network policy \u2014 the address did not resolve to a public host, used an unsupported scheme, or redirected somewhere unsafe." : reach.fetchedPages > 0 ? "The site responded, but no page returned readable HTML content." : "No page on this domain could be fetched.",
      reach
    };
  }
  if (!input.analyzable) {
    const thin = input.coverageLimitation === "site-too-thin";
    return {
      outcome: "inconclusive",
      summary: thin ? "This site has no pages describing what the business sells, so no gap can be claimed." : "The crawl never reached this site's service pages, so no gap can be claimed.",
      limitation: thin ? `${input.coverageReason} Nothing in this client's setup would change that \u2014 the pages simply are not there. A missing-service-page finding needs a site that describes its services somewhere.` : input.coverageReason,
      reach
    };
  }
  if (input.evaluatorErrors > 0) {
    return {
      outcome: "inconclusive",
      summary: input.evaluatorErrors === 1 ? "1 candidate could not be assessed because the evaluator failed." : `${input.evaluatorErrors} candidates could not be assessed because the evaluator failed.`,
      limitation: "The opportunity evaluator was unreachable or returned unusable output. Candidates are dropped rather than guessed, so this run is incomplete.",
      reach
    };
  }
  const limits = incompleteRunReasons(input, reach);
  return {
    outcome: "clean",
    summary: `Read ${reach.readablePages} ${reach.readablePages === 1 ? "page" : "pages"} and found no unmet billable work.`,
    limitation: limits.length > 0 ? limits.join(" ") : null,
    reach
  };
}
__name(classifyAnalysis, "classifyAnalysis");
