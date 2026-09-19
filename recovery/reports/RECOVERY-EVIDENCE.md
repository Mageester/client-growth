# Recovery Evidence Ledger

## Recovery start

- Recovery started: `2026-09-19T17:16:21.5416851-04:00`
- Recovery workspace: `C:\Users\Aidan\Documents\Repos\orbit-sep18-recovery`
- Original checkout: `C:\Users\Aidan\Documents\Repos\client-growth`
- Original GitHub `main` SHA: `1d8e5d0e66ecaa5991b1182fc187738c6da69f1b`
- Recovery clone pre-recovery SHA: `c07a5b6831fc3c3b6f5819445162d06036ab02eb`

## Authoritative production

- Worker: `client-growth-production`
- Account ID: `fe468a56a5b8c7f8fc5d39e265c2f791`
- Version ID: `529a96b3-f525-413f-90da-c32c20505baf`
- Deployment timestamp: `2026-09-18T01:54:34.899862Z`
- Deployment source: Wrangler
- Handlers: `fetch`, `scheduled`
- Compatibility date: `2026-08-31`
- Compatibility flags: `nodejs_compat`
- Production origin: `https://orbit.getaxiom.ca`

## Known artifact hashes

The copied artifact manifest is `recovery/evidence/known/hashes.json`. The three authoritative inputs are preserved byte-for-byte:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `worker-live.mjs` | 5,834,199 | `7bc90e96d98abb00132bf6736ecad96afbf223afaddc8d162cabaea2e2783c40` |
| `version-529a96b3.json` | 10,388 | `b61a3e4331f0d873b11db060dcdc39c4839336694c58f5a9d45f20357d40af41` |
| `extracted/app.js` | 5,833,953 | `e3b996cbc94bf72723866220852ea069fdea09d771de299f67a1aa3dfc0f0611` |

## Initial production metadata recorded

- Runtime assets binding: present and serves directly.
- D1 binding: `DB`, database ID recorded in the source metadata but not copied into source secrets.
- AI provider: `deepseek`.
- DeepSeek model variables: `DEEPSEEK_MODEL`, `DEEPSEEK_VISION_MODEL`.
- Auth origin variable: `BETTER_AUTH_URL=https://orbit.getaxiom.ca`.
- Secret binding names are recorded only as names; values are never copied.

## Evidence source inventory

| Evidence source | Scope | Status | Location/result |
| --- | --- | --- | --- |
| Known Cloudflare payload | Exact Worker bundle | Preserved/hash-verified | `recovery/evidence/known/worker-live.mjs` |
| Extracted Worker script | Exact extracted `app.js` | Preserved/hash-verified | `recovery/evidence/known/extracted/app.js` |
| Cloudflare version metadata | Version/runtime/bindings | Preserved from supplied artifact | `recovery/evidence/known/version-529a96b3.json` |
| Cloudflare API forensics | Complete for documented version/content surfaces | Read-only only | `recovery/evidence/cloudflare/` |
| Public live assets | Complete for public homepage asset graph | Same-origin/application-owned only | `recovery/evidence/live-assets/` |
| GitHub refs/objects | Pending | Read-only search | `recovery/evidence/github/` and `local-git/` |
| Local caches/worktrees | Pending | Bounded search only | `recovery/evidence/caches/` |
| D1 metadata | Pending | Read-only only | `recovery/evidence/database/` |

## Cloudflare forensics result

- `include=modules` returned HTTP 200 with one module, `app.js`, and no separate source-map module or `sourcesContent` field.
- Multipart `content/v2` returned HTTP 200 with one `app.js` part and no `app.js.map` part.
- The supplied bundle's trailing `sourceMappingURL=app.js.map` remains unresolved as an independently downloadable source map.
- The legacy `content` GET path returned HTTP 405; the supported v2 path was preserved in full.
- The complete endpoint log, redacted responses, and hashes are under `recovery/evidence/cloudflare/`.

## Public asset result

- The public homepage and 14 application-owned static assets were captured with status 200.
- The embedded React Router manifest was extracted as `recovery/evidence/live-assets/route-manifest.json`.
- No public application asset exposed a source-map reference or downloadable `*.map` file.
- A first-pass capture also saw a Cloudflare `/cdn-cgi/` script; it was archived separately and excluded from the canonical application-owned inventory.

## Safety log

- No deployment command has been run.
- No Cloudflare setting, traffic, secret, Worker version, or D1 data has been changed.
- No production user, paid analysis, email, or monitoring action has been invoked.
- The original checkout is not used as an edit target.
