# Cloudflare read-only forensics

## Official documentation consulted

- [Workers Versions API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/): stable script-version list/detail endpoints.
- [Get Worker Version](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/): beta Worker-version detail endpoint and `include=modules`; the documented response can include module code and source-map content when present.
- [Source maps and stack traces](https://developers.cloudflare.com/workers/observability/source-maps/): Wrangler uploads source maps when `upload_source_maps` is enabled; the map is used for stack-trace remapping and is not accessible inside a Worker at runtime.
- [Workers API](https://developers.cloudflare.com/api/resources/workers/): stable and beta Workers/version resource families and read-only version detail surfaces.

## Authentication

`npx wrangler whoami` succeeded with the existing Wrangler OAuth profile for the known account. The OAuth token was read in memory by `recovery/tools/cloudflare-forensics.ps1` and was never printed, saved, or committed. The evidence records only redacted endpoint metadata.

## Probed endpoints

| Endpoint/result | Status | Evidence | Finding |
| --- | ---: | --- | --- |
| `GET /accounts/<account-id>/workers/workers/client-growth-production/versions/529a96b3-f525-413f-90da-c32c20505baf?include=modules` | 200 | `responses/beta-version-include-modules.json` | Returned one module named `app.js`; no separate map module or map field was present. |
| `GET /accounts/<account-id>/workers/scripts/client-growth-production/versions/529a96b3-f525-413f-90da-c32c20505baf` | 200 | `responses/script-version-detail.json`, `version.json` | Returned stable version metadata/resources and bindings; no source-map resource was exposed. |
| `GET /accounts/<account-id>/workers/scripts/client-growth-production/content/v2` | 200 | `content/script-content-v2.bin` | Returned one multipart `app.js` part; no `app.js.map` part. |
| `GET /accounts/<account-id>/workers/scripts/client-growth-production/content` | 405 | `endpoint-results.json` | GET is not allowed on this legacy content path. |

## Module/content comparison

- The beta endpoint's decoded `app.js` is 5,833,954 bytes and ends with one LF; removing only that transport-ending LF makes it byte-identical to the supplied `extracted/app.js` (5,833,953 bytes).
- The multipart v2 response contains one `app.js` part. Its app payload is also identical to `extracted/app.js` after removing only the final LF.
- The deployed bundle itself contains `//# sourceMappingURL=app.js.map`, but neither Cloudflare module response includes a separate `app.js.map` module or `sourcesContent` field.
- The multipart payload hash is `e242edccaf699afa67f18a5722c00324109c4c808ead8db5d317456c28033246`.
- The beta response hash is `a179514217cd64d3395e08f1405471ce350674dd7183bc3e3c1d14f0546b817b`.
- The decoded beta app hash is `e27fd650482d54c9f574c93f6c1ca4f29378712c401a267eb42224b97455d7cc`; this differs from the known extracted-file hash only because of the trailing LF.

## Runtime metadata recovered

The version detail confirms compatibility date `2026-08-31`, `nodejs_compat`, `fetch` and `scheduled` handlers, assets configured to serve directly, `DB`, `ASSETS`, `BROWSER`, DeepSeek model variables, and `BETTER_AUTH_URL=https://orbit.getaxiom.ca`. Secret binding values were not present in the saved response and were not queried separately.

## Source-map conclusion

Cloudflare exposed the complete deployed JavaScript module payload and version metadata, but the documented `include=modules` response and the multipart content response exposed only `app.js`. The independent source-map surfaces tested here therefore produced no recoverable `app.js.map`. This is a documented negative finding, not proof that no historical upload ever existed; later recovery will still inspect public asset references, Git history, local caches, and any additional version resources discovered from the bundle/API.

## Safety

Only GET/read operations were used. No version upload, deploy, traffic change, secret read/write, D1 write, migration, or deletion operation was run.
