# Axiom Orbit launch completion

The user-approved brief is the twelve-item P0–P2 backlog supplied on 2026-09-04. The auth-origin outage was resolved first in commit `2eae511`, deployed as `ac962118`.

Preserve evidence provenance, tenant isolation, human confirmation, and the distinction between clean and inconclusive. Use Node 24, deterministic tests, the offline analyzability corpus, and rendered design-harness checks. No live AI or email acceptance probes without a concrete need. Commit each numbered item separately after focused verification; run the complete release gate on the integrated result.

## P0 — operating safety

- [x] 1. Persist atomic analysis admission before any paid work: five-minute client cooldown and 50 starts per workspace per UTC day. Show the reason and retry time in all manual entry points; scheduled admission shares the limit. Test races, boundaries, failures, and tenants.
- [x] 2. Confirm client deletion by name, delete only within the current workspace, and verify all dependent records cascade while the catalog and other clients survive.
- [x] 3. Require email verification, wire the existing Resend transport, and provide a resend route for existing unverified accounts. Exercise signed tokens and canonical-origin callbacks with mocked transport.
- [x] 4. Namespace the two verified production smoke workspaces with a reserved test prefix, retaining their data and excluding them from automated customer monitoring.

## P1 — recurring customer value

- [x] 5. Add a seven-day portfolio changes view from durable analysis run facts, retaining inconclusive checks as such; use it as the returning-user landing page.
- [x] 6. Add evidence-backed title, thin-service-page, H1, internal-link, meta-description, structured-data and image-alt checks. Missing fields in legacy evidence remain unknown. Every rule has a catalog tag, starter price and positive/negative tests. Preserve absence verification and deduplicate overlapping service-page claims.
- [x] 7. Export explicitly saved proposals through revocable, expiring share links, with explicitly saved agency name and logo, a Prepared by line, and the existing evidence-backed scope/pricing. Keep export tenant-scoped.

## P2 — trial and operations friction

- [x] 8. Add owner-managed, expiring single-use team invitations bound to verified recipient identity; expose roles and membership in settings.
- [x] 9. Add bulk client entry with a preview and explicit confirmation, bounded input, row-level validation and tenant-scoped duplicate checks. Do not crawl or analyze on import.
- [x] 10. Put concrete offerings examples and readiness guardrails alongside every editable offerings field; preserve explicit saving.
- [x] 11. Infer catalog tags deterministically from service name/description and show the proposed mapping before saving; keep explicit override available.
- [x] 12. Add tenant-scoped data export and an operations view with scan outcomes, evaluator failures, and a visible alert for elevated inconclusive rates. Never expose another tenant's data or secret/provider payloads.

## Integration acceptance

- [x] `pnpm verify` and `git diff --check`.
- [x] `pnpm analyzability --offline`: inspect false-analyzable count, not just exit status.
- [x] Render new states in the design harness and inspect screenshots and reachable controls.
- [x] Apply additive migrations only after migration parity and foreign-key tests pass; clean build, deploy, verify canonical auth origin again.
- [x] Record exact shipped scope and remaining live-only acceptance limits.
