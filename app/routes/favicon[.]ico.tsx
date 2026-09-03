/**
 * Browsers request /favicon.ico regardless of the <link rel="icon"> in the
 * document head. Without a route, React Router throws "No route matches URL"
 * and the Worker logs an error for every cold page view.
 *
 * The mark is approved brand artwork rather than a hand-drawn substitute, so
 * this redirects to the real app icon instead of inlining a lookalike.
 */
export function loader() {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/brand/axiom-orbit-app-icon-32.png",
      "cache-control": "public, max-age=86400",
    },
  });
}
