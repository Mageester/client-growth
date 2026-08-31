# Live tests

Nothing here runs in `pnpm test`.

Files named `*.live.ts` in this directory are run **only** by:

```bash
pnpm eval:live
```

They are allowed to make real, paid provider calls and real network requests.
Set the provider explicitly first, e.g.:

```bash
AI_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... pnpm eval:live
```

The live DeepSeek smoke test and the live HTTP-crawl smoke test land here in
Phase C. Until then this directory is intentionally empty of tests.
