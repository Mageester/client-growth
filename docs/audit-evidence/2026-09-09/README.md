# Astra audit evidence — September 9, 2026

Parent report: [ASTRA_PRODUCT_AUDIT.md](../../../ASTRA_PRODUCT_AUDIT.md).

All screenshots were captured and visually inspected during this audit. `live` means the deployed app at orbit.getaxiom.ca; live customer/account pages were read-only. `local` means an isolated Worker at localhost:8799 with synthetic accounts and data. Local public-site reads are real bounded HTTP reads, but local evaluator and mail transport were mock/console. Local tokens visible in screenshots have no production authority.

## Reproductions and execution evidence

| File | Scope |
|---|---|
| `deployment-observation.json` | Sanitized read-only deployed version/config observation. |
| `deployed-assets.json` | Public frontend asset names compared with the current local build. |
| `readiness-reproduction.json` | Same stored local evidence through unchanged rule/readiness functions; no added network or evaluator. Proves the candidate/admission contradiction, not a verified sale. |
| `report-sharing-reproduction.json` | Anonymous report remains 200 after private reload removes revoke controls; no saved-report navigation found. |
| `digest-form-reproduction.json` | Two send-button clicks saved preferences; rendered controls and source explain duplicate intent. Hidden input value is established by source, not the DOM inspection surface. |
| `account-boundaries.json` | Real local Better Auth session in a second configured workspace; foreign client/opportunity/report 404, anonymous 302, isolated export 200. |
| `share-response.json` | Anonymous local proposal sharing/header check; completed revocation subsequently returned 404. |
| `responsive-dimensions.json`, `responsive-selected-client.json` | Browser-measured CSS dimensions and overflow. Selected long client name is required to reproduce the main compact-width filter issue. |
| `verify.log` | One complete successful local verify: 141 test files, 1,260 tests, typecheck and build. Expected fault-injection logs are not failing tests. |
| `analyzability.json` | Current analyzer against 24 cached sites, offline replay; not current live network reach. |
| `current-corpus-candidates.json` | Existing fixture script's raw rule candidates, before evaluator judgment. Not approved customer opportunities. |
| `bench.log` | Current offline diagnostic MockEvaluator run; exit zero does not mean semantic quality passed. |

## Screenshots

| File | What to inspect |
|---|---|
| `01-live-home-desktop.png` | Public positioning and primary access CTA. |
| `02-live-pilot-dead-end.png` | Closed signup page offers login instead of a request action. |
| `03-live-tour-trust-claim.png` | Current in-app introduction/trust framing. |
| `05-live-h1-opportunity.png` | Actual deployed H1 finding and its commercial presentation. |
| `06-local-onboarding-first-screen.png` | Setup hierarchy and prominent optional catalog assistant. |
| `07-local-readable-site-called-unreadable.png` | Contradictory exhaustive-site read language. |
| `08-local-analysis-disabled.png` | Saved client with analysis unavailable. Earlier browser sizing used inherited zoom; use later measured images for precise responsive claims. |
| `09-live-product-desktop.png` | Deployed product page; this is desktop, not mobile. |
| `10-local-opportunities-mobile.png` | Earlier compact mobile feed; later image 20 supplies clean measured reproduction. |
| `11-local-shared-proposal-mobile.png` | Synthetic public proposal, measured 430×928. |
| `12-local-client-report-desktop.png` | Report's document treatment and content hierarchy. |
| `13-local-billing-anchor.png` | Billing label lands on account email. |
| `14-local-monitor-gated.png` | Same monitoring gate as production using a synthetic email. |
| `15-local-digest-wrong-action.png` | Enabled monitoring and send control; the offscreen status is recorded in the JSON reproduction. Screenshot alone does not prove which action ran. |
| `16-local-report-share-before-refresh.png` | Share callout and revoke control immediately after creating a link. |
| `17-local-report-share-after-refresh.png` | Same saved private report after refresh; share-management callout gone. |
| `18-local-opportunities-laptop.png` | Measured 1280×800 layout. |
| `19-local-opportunities-mobile-390.png` | Measured 390×844 layout with All clients selected. |
| `20-local-mobile-client-filter.png` | Measured 355×767 with a selected long client name and horizontal overflow. |

Image 04 was intentionally excluded because it included a real account email; image 14 recreates the relevant gate using synthetic data. The ignored local harness contains additional raw development logs and synthetic verification/reset URLs. It is not release evidence and should not be published.

## Additional browser observations

- Thirty valid CSV rows imported into the initial two-client local workspace. Existing domain, malformed domain, and within-file duplicate each produced a row-specific error before importing.
- Search found Portfolio 30 and produced a clear no-match state. Deleting that unused synthetic client required its exact name; the wrong name was rejected and the final portfolio count was 31.
- Manual service creation rejected an inverted range, then saved a corrected synthetic service. The AI assistant rejected empty input using raw validation JSON; a nonempty request honestly declined because no AI catalog provider was available locally.
- Own-client domain was rejected as a competitor. Two example-domain references produced an explicit insufficient-read comparison, with no claimed gap.
- Weekly cadence persisted when enabled locally; no due scheduled tick or real email delivery was claimed. The manual digest control selected preference saving twice.
- A synthetic team invitation rejected acceptance by a different signed-in email and was revoked.
- Logout blocked a private report deep link. Local console-delivered password recovery reached the reset UI, reset successfully, and login with the new password returned to Home. No real email was sent.
- Proposal edit/share/revocation and pitched/sold state were exercised; synthetic $225 sold state survived reanalysis. Report sharing separately has the retrieval/revocation UI defect documented above.

No production code, deployments, customer records, or account settings were changed. No real prospect messages, purchases, or paid AI calls were made. Live provider accuracy/cost, inbox delivery, native PDF output, sustained load, full accessibility, all back/forward-history permutations, and paid demand remain outside the verified results.
