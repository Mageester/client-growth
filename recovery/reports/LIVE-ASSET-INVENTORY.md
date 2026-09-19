# Live asset inventory

## Scope

- Origin: `https://orbit.getaxiom.ca/`
- Request method: GET only, no cookies or authorization headers
- Final canonical capture: `recovery/evidence/live-assets/`
- Initial capture with a Cloudflare `/cdn-cgi/` script was preserved as `recovery/evidence/live-assets-initial/`; the corrected enumerator rejects that infrastructure path.
- The public homepage returned HTTP 200 and exposed a React Router manifest, 4 application brand images, 7 JavaScript assets, and 3 CSS assets.

## Application-owned public assets

| URL | Status | Bytes | SHA-256 | Local path |
| --- | ---: | ---: | --- | --- |
| `https://orbit.getaxiom.ca/` | 200 | 24,361 | `0da7b8ada71a3fb1f3fd84a8865922400ad930244b12ca5fccaa1935307119fc` | `assets/index.html` |
| `/brand/axiom-orbit-primary-transparent.png` | 200 | 308,672 | `9f6bbf12d1e3681e428944f32bca57afe62d2fcd6ae5125ba398dd2cbec74f73` | `assets/brand/axiom-orbit-primary-transparent.png` |
| `/brand/axiom-orbit-app-icon-32.png` | 200 | 812 | `1d84fe6dce9f4d417f095c615996e87283a9cb9d76d6f231a9a1e77e4d687cc7` | `assets/brand/axiom-orbit-app-icon-32.png` |
| `/brand/axiom-orbit-app-icon-64.png` | 200 | 2,109 | `e9b028f4d33cc4c2b008b8aaa68b28ac5243e7435d7830641c4ee146fa49ca35` | `assets/brand/axiom-orbit-app-icon-64.png` |
| `/brand/axiom-orbit-app-icon-256.png` | 200 | 17,421 | `88b0f4206973c3f486584ee2336e9d1999e10db6e95e7993ce0626c5f76296d5` | `assets/brand/axiom-orbit-app-icon-256.png` |
| `/assets/entry.client-DA5ElLgt.js` | 200 | 190,032 | `209eebce933efbc23ae61905bd1e802fdaee14e8011ddd6d23b0ac02b13191ec` | `assets/assets/entry.client-DA5ElLgt.js` |
| `/assets/chunk-BV7QT456-C5gx_Rvz.js` | 200 | 131,442 | `2b3aa5efcfcf776e97d3c9333435545ebe80ef5ec3fcbe5064ebdd86f62ee364` | `assets/assets/chunk-BV7QT456-C5gx_Rvz.js` |
| `/assets/root-DOL8tCYu.js` | 200 | 13,806 | `c60bf6385a4e6bfafd85c7cf8b353e76312ceff5dbe386e71f01ae7667435e37` | `assets/assets/root-DOL8tCYu.js` |
| `/assets/ui-BJ6uvrLM.js` | 200 | 16,221 | `9eb138708ee3d3d5b52bf5732161be9b3b061a8ce25579885985987eee8c8fa1` | `assets/assets/ui-BJ6uvrLM.js` |
| `/assets/unavailable-document-D0QRylR_.js` | 200 | 1,426 | `4935217e01e9fe2dc773868c1e0a272aed4804d07998f1e93c6645993a04d206` | `assets/assets/unavailable-document-D0QRylR_.js` |
| `/assets/_index-CFuuiImH.js` | 200 | 13,976 | `30dc82a907ccfe3f6f2a113b2dc0586ad6e1ff7cd7c264c22f81c7999820b9ed` | `assets/assets/_index-CFuuiImH.js` |
| `/assets/marketing-layout-Be8eIuWm.js` | 200 | 3,521 | `c896d2621bef261ef500c786eb5e92bed5772d6e8ce2829d4ff986e0a22769a6` | `assets/assets/marketing-layout-Be8eIuWm.js` |
| `/assets/root-C5hxMEjn.css` | 200 | 238,376 | `51ddc3c11f01ded37422dba15f05b4a0dfd3e638e7e2babe6717ac02ac7781e4` | `assets/assets/root-C5hxMEjn.css` |
| `/assets/_index-TDD4P4hm.css` | 200 | 20,843 | `cad35baf2aa7cd2263a888eee033f00e9a9945cc234eb3287781d7b32e094bb7` | `assets/assets/_index-TDD4P4hm.css` |
| `/assets/marketing-layout-BUeFvU3i.css` | 200 | 49,110 | `c6b32d461d4f6c1a2b2726323559f4266b11991c9d5a730e5d69a1299047f9d7` | `assets/assets/marketing-layout-BUeFvU3i.css` |

## Route/build manifest

The public HTML embeds and the capture extracts `route-manifest.json`:

- Manifest version: `ab2acd58`
- Manifest URL: `/assets/manifest-ab2acd58.js`
- Entry module: `/assets/entry.client-DA5ElLgt.js`
- Public routes in the server-rendered manifest: `root`, `routes/_index`
- Route CSS: `root-C5hxMEjn.css`, `_index-TDD4P4hm.css`, and `marketing-layout-BUeFvU3i.css`

## Source-map results

- No downloaded application JS or CSS contained a `sourceMappingURL` reference.
- No public `*.map` file was discovered or fetched.
- No `sourcesContent` was available from the public asset set.
- External Google Fonts assets were not downloaded because they are not application-owned.
- Cloudflare `/cdn-cgi/` challenge infrastructure was excluded from the canonical capture and remains only in the archived initial-run evidence.
