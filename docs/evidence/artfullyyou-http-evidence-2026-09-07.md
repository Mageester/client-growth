# Artfully You HTTP evidence incident — 2026-09-07

## Scope

The production-equivalent Orbit HTTP evidence path was tested against `artfullyyou.ca` after a production report of zero readable pages and an inconclusive analysis.

Provider configuration:

- `HttpEvidenceProvider({ maxPages: 10, signal })`
- owning analysis deadline: 45,000 ms
- per-request timeout: 8,000 ms
- maximum redirects: 5
- maximum requests: 40
- maximum response body: 2,500,000 bytes
- User-Agent: `AxiomOrbitBot/1.0 (+https://getaxiom.ca/bot; website evidence for the site's own agency)`

## Reproduction

The provider was run inside a temporary remote Cloudflare Worker, using the same provider import and configuration used by `app/lib/analysis.server.ts`. The remote run returned:

```text
pages: []
sitemapUrls: []
crawlExhaustive: false
networkEvents:
  https://artfullyyou.ca/sitemap.xml -> inconclusive: request timeout
  https://artfullyyou.ca/ -> inconclusive: request timeout
```

A direct fetch from the same remote Worker was also held until a separate 30,000 ms diagnostic ceiling and ended with `AbortError: The operation was aborted`; no HTTP response was received in that interval.

For comparison, the same provider configuration from the local Node runtime read ten pages from the domain, including `/`, `/classes`, `/paint-nights`, `/private-events`, `/live-music`, `/art-for-sale`, `/prices`, `/shop-supplies`, `/about-us`, and `/contact-us`. The local run had no network events. The `www` spelling also succeeded locally.

## Root cause

The exact observed failure is a **Cloudflare Worker-to-origin transport timeout**: the remote runtime did not receive any response from the origin within the request timeout. This is not a proven robots, redirect, content-type, response-size, JavaScript-shell, or WAF classification because no status, headers, or body were observed. It also is not safe to claim a DNS-specific failure; the evidence establishes only that the production runtime's network path did not return a response.

Orbit therefore remains inconclusive and creates no findings for this run.

## Safe v1 handling

New evidence bundles preserve stable failure `code` and `stage` metadata. A zero-readable crawl may make one bounded same-site apex/`www` retry after a timeout/network failure through the existing public-origin policy. Only successfully fetched and parsed HTML becomes evidence. If the retry also fails, Orbit keeps the run inconclusive and surfaces the transport explanation; no browser-rendering path or synthetic evidence is used.
