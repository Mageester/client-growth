# Production recovery matrix

- Bundle index input SHA-256: `e3b996cbc94bf72723866220852ea069fdea09d771de299f67a1aa3dfc0f0611`
- Project-owned production regions: 100
- Main-present regions: 64
- Main-missing regions: 36
- Exact source recovery from GitHub/source maps: none established at this stage; branch candidates are source skeletons pending semantic comparison.
- Candidate score weights: exact path 40, symbols 25, imports 10, routes 5, environment keys 5, SQL 10, meaningful strings 5.

| Production module | Main state | Best branch/source | Confidence | Action required |
| --- | --- | --- | --- | --- |
| `src/core/monitoring.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/monitoring.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/analysisLimits.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/analysisLimits.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/catalogGenerationLimits.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/catalogGenerationLimits.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/config/env.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/config/env.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/d1.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/d1.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/allowlist.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/allowlist.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/entitlements.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/entitlements.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/monitoring.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/monitoring.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/workspaces.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/workspaces.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/ruleIds.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/insightTaxonomy.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/analysisAccounting.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/visualSchema.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/schema.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/schema.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/evidenceDiagnostics.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/evidenceDiagnostics.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/analysisOutcome.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/analysisOutcome.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/offeringDrift.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/offeringDrift.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/commercialLanguage.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/commercialLanguage.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/text.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/core/text.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/externalBusinessEvidence.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/externalBusinessEvidence.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/tenant.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/db/tenant.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/insightSchema.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/siteUnderstandingSchema.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/analysisLifecycle.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/db/insights.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/db/repositories.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/repositories.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/FixtureEvidenceProvider.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/adapters/evidence/FixtureEvidenceProvider.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/urlPolicy.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evidence/urlPolicy.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/siteStructure.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/siteStructure.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/parseHtml.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evidence/parseHtml.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/robots.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evidence/robots.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/HttpEvidenceProvider.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evidence/HttpEvidenceProvider.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evaluator/MockEvaluator.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evaluator/MockEvaluator.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evaluator/prompt.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evaluator/prompt.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evaluator/DeepSeekEvaluator.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/adapters/evaluator/DeepSeekEvaluator.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evaluator/createEvaluator.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/adapters/evaluator/createEvaluator.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/offeringSuggestions.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/offeringSuggestions.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/context.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/core/rules/context.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/evidenceRef.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/evidenceRef.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/registry.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/registry.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/diagnosticCompatibility.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/pageIdentity.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/rules/thinServicePage.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/thinServicePage.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/diagnosticAggregation.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/rules/technical.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/technical.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/dedupe.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/dedupe.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/visualReview.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/absenceVerification.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/absenceVerification.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/businessSiteMismatch.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/businessSiteMismatch.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/measurementLimits.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/conversionIntent.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/core/conversionIntent.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/brokenConversionPath.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/brokenConversionPath.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/duplicateTitle.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/duplicateTitle.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingH1.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingH1.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingImageAlt.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingImageAlt.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingMetaDescription.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingMetaDescription.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingServicePage.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingServicePage.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingStructuredData.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingStructuredData.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/missingTitle.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/missingTitle.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/noServicePages.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/noServicePages.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/placeholderSignatures.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/rules/bookingCardSkeleton.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/rules/brokenInternalLink.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/brokenInternalLink.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/evidenceLedger.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/rules/broadDetectors.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/threshold.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/threshold.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/billability.ts` | present | refs/remotes/github/codex/client-growth-network-hardening @ 0cf05e1cb80d:src/core/billability.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/judgment.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/judgment.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/rules/deterministicEvaluation.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/rules/deterministicEvaluation.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/assembleOpportunity.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/assembleOpportunity.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/diagnosticIdentity.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/qualityGate.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/problemSynthesis.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/semanticDrafts.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/insightSnapshot.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/findingSchema.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/claimBinding.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/findingPublication.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/pipeline/analyzeClient.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/pipeline/analyzeClient.ts | UNRESOLVED | Compare main source semantics and apply only production-backed changes |
| `src/adapters/evidence/CloudflareVisualCapture.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/adapters/evaluator/DeepSeekVisualCritic.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/adapters/evaluator/DeepSeekVisualReviewer.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/db/visualScreenshots.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `app/lib/visual-review.server.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/db/analysisLifecycle.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/core/providerPricing.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/db/providerUsage.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `app/lib/provider-usage.server.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/adapters/evaluator/DeepSeekSiteUnderstanding.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `src/adapters/evaluator/DeepSeekInsightCritic.ts` | missing | No reachable GitHub source candidate | UNRESOLVED | Reconstruct from production bundle and neighboring types |
| `app/lib/analysis.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/analysis.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/monitoring.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/monitoring.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/clientValue.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/clientValue.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/core/monitorDigest.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/core/monitorDigest.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `src/db/monitorDigests.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:src/db/monitorDigests.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/resend.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/resend.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/workerContext.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/workerContext.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/auth.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/auth.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `app/lib/monitorDigest.server.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:app/lib/monitorDigest.server.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |
| `workers/app.ts` | present | refs/remotes/github/main @ 1d8e5d0e66ec:workers/app.ts | MEDIUM-CONFIDENCE RECONSTRUCTION | Compare main source semantics and apply only production-backed changes |

## Branch aggregate overlap

| Branch refs | Unique tip | Candidate regions | Mean score |
| --- | --- | ---: | ---: |
| refs/remotes/github/main | `1d8e5d0e66ecaa5991b1182fc187738c6da69f1b` | 64 | 65.8586 |
| refs/remotes/github/codex/integrate-reports-and-analysis-safety | `487544109310ebd0b5feb729a469184ddec4976f` | 64 | 65.8556 |
| refs/remotes/github/ops/activate-deepseek-production | `ca2a3e2d44a432d255f8f49f8952027339231ef5` | 10 | 64.5998 |
| refs/remotes/github/feat/axiom-orbit-product-polish | `5d67bb3e7d51a8f39776fb7d96ffd7c87a164f2e` | 55 | 63.609 |
| refs/remotes/github/codex/client-growth-reset-email-fix | `2346992d69dd7bd966880ddfd5280e662d0b66d6` | 15 | 63.4012 |
| refs/remotes/github/codex/client-growth-blue-ui | `6c27078afcd3d1696a9e947b21db857542427cf3` | 14 | 62.7512 |
| refs/remotes/github/claude/bug-testing-verification-b6al1u | `224f3e4f6483fa9623bc87a29ad1bb1a9a262d0d` | 16 | 62.7408 |
| refs/remotes/github/codex/axiom-orbit-marketing | `8b68a21603e7c89d7c4fb4a658fdc2f97c32f7f3` | 29 | 62.5309 |
| refs/remotes/github/codex/premium-signal-desk-redesign, refs/remotes/github/new-ui | `3ff2fb5edc515d769094a3c97fb8befb23cd0916` | 40 | 62.3253 |
| refs/remotes/github/fix/thin-site-semantics | `a32c7b949eb6246fd289f4605a77fae1a6eb5d3a` | 26 | 62.0959 |
| refs/remotes/github/codex/client-growth-productization | `a11892e51a8070d94eee5cc0d3f3ad8831b84171` | 14 | 61.5334 |
| refs/remotes/github/codex/client-growth-network-hardening | `0cf05e1cb80d7b53478b22168821f0201a617fa6` | 16 | 59.8189 |
| refs/remotes/github/feat/real-site-analyzability | `fbf08ea56c37623caac9839022981dcc73ef28ea` | 15 | 59.5522 |
| refs/remotes/github/backup/release-safety-local-2026-09-05 | `adf2b915d30bac76433d0396010a0c1d385656ce` | 0 | 0 |
| refs/remotes/github/codex/client-growth-release-safety, refs/remotes/github/codex/client-growth-release-safety-reconciled | `ca63ef1b9bf7c28648bc012d10c80899a734fc04` | 0 | 0 |
