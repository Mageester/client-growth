# Launch backlog acceptance — 2026-09-04

This release follows the user-approved twelve-item brief. The production auth-origin outage was fixed first; production authentication belongs to `orbit.getaxiom.ca`. The workers.dev hostname is a page preview, not an authentication entry point.

## Delivered scope

1. Atomic analysis admission: five-minute client cooldown, 50 starts per workspace per UTC day, enforced before crawling or paid evaluation. Manual and scheduled starts share the ledger; rejected starts show a reason and retry time.
2. Tenant-scoped client deletion with typed name confirmation and dependent-record cascades.
3. Required Better Auth email verification, Resend verification transport, and resend guidance for existing unverified accounts.
4. Both existing production smoke workspaces retain their data under `[TEST]` names and are excluded from scheduled customer monitoring.
5. Returning users land on This week: completed checks, new findings, resolved findings, and inconclusive results from durable run records.
6. Eleven rules, including eight new deterministic checks for missing/duplicate titles, thin service pages, missing H1, confirmed broken internal links, missing meta descriptions, absent structured data, and missing image-alt attributes. Every new rule has catalog mapping, starter pricing, and positive/negative coverage. Legacy missing evidence fields remain unknown; empty decorative alt text is not treated as missing. Closure requires readable, revisited evidence.
7. Saved proposals can be shared through expiring, revocable links containing an immutable snapshot, agency name/logo, Prepared by, scope and pricing. Tokens are hashed at rest; public responses are private/no-store, no-referrer and noindex. Draft formatting is rendered without raw HTML.
8. Owners can create/revoke invitations and inspect team roles. Acceptance requires the matching verified email, is single use, and inserts membership atomically. Missing mail transport leaves a manual invitation link.
9. CSV import previews and confirms client profiles, with row/byte limits, tenant duplicate checks and atomic insert-only writes. Import starts no crawl or analysis.
10. Offering fields show concrete examples and immediate partial-setup/vague-claim guidance. Saving remains explicit.
11. Service names/descriptions produce deterministic proposed mappings. A collapsed override preserves user choices; nothing is written before Save.
12. Tenant data export excludes authentication records and token hashes. Check health shows outcomes, evaluation errors, failed/incomplete starts, and a visible elevated-inconclusive-rate alert.

## Acceptance boundaries

- Deterministic route/database tests exercise tenant separation, limits, invitation identity and races, share expiry/revocation, metadata evidence gates and incomplete outcomes.
- Offline corpus: **19/24 analyzable, false analyzable: none**; 314 requests replayed, zero fetched, zero AI calls. One known discovery limitation remains; unreadable sites are not relabelled clean.
- The design harness was used to inspect onboarding, weekly changes, verification guidance, health alerts, proposal sharing and import. Mobile proposal/health layouts were inspected. An import padding issue and raw proposal Markdown were found visually and corrected.
- Local acceptance uses an isolated D1 state, mock evaluator, zero AI-call budget and synthetic `.test` users. Sign-in, saved-proposal sharing and manual invitation creation were exercised there.
- Real email delivery and live DeepSeek judgment are not claimed as acceptance results. Verification/invitation transport tests mock Resend. Production secrets were checked by name only.
- The health alert is in-app; this release does not add a paging service or email digest. Export is capped at 10,000 records per collection and rejects oversize collections rather than returning a partial export.

## Release evidence

- Deployed source commit: `9e69587` (last feature commit `c6036ba`). Each numbered item has its own commit; later review corrections are separate.
- `pnpm verify`: passed, **770 tests across 92 files**, repository safety, production preflight, typecheck and clean build. `pnpm deploy:production` repeated preflight, typecheck and build successfully.
- Production migrations `0009`–`0012`: applied. Remote `PRAGMA foreign_key_check`: no violations.
- Worker version: `4a01c149-8ac4-429c-9e94-432ee272ef91`.
- Post-deploy canonical-origin sign-in probe: HTTP **401**, `INVALID_EMAIL_OR_PASSWORD`, using a nonexistent synthetic account. No `INVALID_ORIGIN`.
- Preview-origin sign-in probe: HTTP **403**, `INVALID_ORIGIN`. Both canonical and preview login pages return HTTP **200**.
- Built local browser acceptance: CSV preview followed by confirmation added exactly two clients; service mapping proposed two title-related tags and saved only the explicitly retained override. A mixed-case/trailing-slash share URL remained standalone while signed in. Tenant export returned six local clients and four services with `private, no-store`, and no secret columns.
- Existing untracked `.analyzability-after2.json` was preserved. No push was performed.
