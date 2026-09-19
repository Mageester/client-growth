// app/lib/auth.server.ts
function getTrustedAuthBaseURL(env2) {
  const baseURL = env2.BETTER_AUTH_URL?.trim();
  if (!baseURL || !/^https?:\/\//.test(baseURL)) {
    throw new Error(
      "BETTER_AUTH_URL is missing. Set the explicit, trusted base URL (e.g. http://localhost:8787 locally, https://app.example.com in production)."
    );
  }
  return baseURL;
}
__name(getTrustedAuthBaseURL, "getTrustedAuthBaseURL");
