# Paused Business-to-site mismatch migration

`0023_external_business_claims.sql` is preserved here as a non-production
design/feature artifact. It is intentionally outside the configured `migrations`
directory, so a report deployment cannot apply it.

When Business-to-site mismatch is approved for production, regenerate and
renumber this migration after the active production chain at that time. Do not
copy it back as `0023`; reports now own that production migration number.
