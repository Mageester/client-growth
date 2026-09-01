/**
 * Browsers request /favicon.ico regardless of the <link rel="icon"> in the
 * document head. Without a route, React Router throws "No route matches URL"
 * and the Worker logs an error for every cold page view.
 *
 * The mark is served here as an SVG so the icon costs one small, cacheable
 * response and stays identical to the inline one in root.tsx.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#17191f"/><g stroke="#fff" stroke-width="2.8" stroke-linecap="round" fill="none"><path d="M10 22.5v-6"/><path d="M16 22.5v-11"/><path d="M22 22.5v-14"/></g></svg>`;

export function loader() {
  return new Response(MARK, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    },
  });
}
