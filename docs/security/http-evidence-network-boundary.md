# HTTP evidence network boundary

`HttpEvidenceProvider` is intentionally a small, bounded HTTP fetcher. It
collects enough public website evidence for deterministic opportunity rules; it
is not a browser, a renderer, a port scanner, or a DNS security service.

## URL and redirect policy

Every destination is parsed with the WHATWG `URL` implementation before policy
decisions are made. The parsed form is the form used for comparisons and
requests, so scheme/host case, trailing dots, and the alternate IPv4 spellings
that Node/workerd accepts are normalized first. IPv4-mapped and
IPv4-compatible IPv6 literals inherit the IPv4 policy.

Only `http:` and `https:` are requestable. `mailto:`, `tel:`, and other
non-HTTP links can remain evidence, but are never fetched. URLs containing a
username or password are rejected, including userinfo that makes a private
address appear to be part of a public hostname. Credential-bearing HTTP links
and form actions found in HTML are omitted from persisted evidence as well.

The hostname policy rejects loopback, unspecified, private, link-local,
multicast, documentation, reserved, and other non-public IP literals across
the supported IPv4 and IPv6 forms. It also rejects `localhost` (including
subdomains and trailing-dot forms), `.local`, common internal suffixes, and
single-label/internal-style hostnames. Same-origin crawl and verification
targets are compared using canonical URL origins; string-prefix matching is
not used.

Redirects are requested manually. A `Location` value is parsed and validated,
including the same-origin rule, before the next request is issued. Unsafe
redirects are blocked. If a fetch implementation reports a different final
URL despite manual mode, the result is inconclusive because its hidden hops
cannot be counted or validated. The redirect limit counts actual followed
hops and fails closed when exhausted.

## Resource and request limits

The defaults are deliberately finite. Integrations may lower these limits for
a narrower run; the provider does not allow configuration to raise the safety
ceilings:

| Resource | Default |
| --- | ---: |
| Crawled page attempts | 10 |
| Sitemap URLs retained | 100 |
| Sitemap-index child documents | 2 |
| HTML/XML response body | 1,000,000 bytes (1 MiB) |
| Timeout per request/hop, including body consumption | 8,000 ms |
| Redirect hops per request | 5 |
| Requests per provider run | 40 |

The shared request budget charges every issued request, including redirect
hops, `HEAD`, `HEAD`→`GET` fallbacks, sitemap/index requests, targeted absence
verification, and broken-conversion probes. A `Content-Length` above the body
cap is rejected before reading. Responses without a trustworthy length are
read through a streaming reader and cancelled as soon as the cap is exceeded.
Binary/arbitrary content types are rejected before parsing. HTML accepts
`text/html` and `application/xhtml+xml`; sitemaps accept the ordinary XML,
`+xml`, and text forms used by real sites, while retaining URL and byte caps.

The default User-Agent is the stable product identifier
`ClientGrowthBot/0.1 (+website evidence; operated by the agency)`. It is
centralized and configurable, but does not claim to be a browser or search
engine.

## Failure semantics

Blocked destinations, unsafe redirects, exhausted redirect/request budgets,
timeouts, oversized bodies, transport failures, and invalid content types are
recorded as blocked or inconclusive network events. They do not create an
opportunity rule, a missing-page conclusion, or an evaluator call. A probe
with no trustworthy status returns `status: 0` and must be treated as
inconclusive. A normal HTTP 404 response remains a usable website signal; a
request that could not be safely completed does not become absence evidence.

## Residual DNS limitation

Cloudflare Workers does not give this implementation authoritative control over
DNS resolution of an arbitrary hostname before `fetch`. Therefore hostname and
IP-literal validation substantially reduces SSRF exposure, but it cannot prove
that a public-looking DNS name will not resolve or later rebind to a private
destination. Complete DNS-rebinding protection is not claimed here. A future
deployment that needs that guarantee must add a controlled egress/DNS layer
outside this provider and enforce its result at the network boundary.
