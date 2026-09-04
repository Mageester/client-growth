# Test workspace namespace

Workspaces whose name starts with `[TEST] ` are reserved for fixtures and operational smoke checks. The scheduler excludes them both when selecting due clients and when claiming a selected client. Their records remain available to the fixture account for manual inspection. Do not use this prefix for a customer workspace or rename fixtures out of it.

The two legacy production smoke workspaces were namespaced on 2026-09-04 without deleting accounts, clients, evidence, or runs:

- `ws_4420e72588c44c6bb934`: `[TEST] CG Production Smoke A mtiudgwgfhfexl`
- `ws_8acaa4f317aa4b1f99bc`: `[TEST] CG Production Smoke B mtiudgwgfhfexl`

The idempotent operation is recorded in `scripts/namespace-production-smoke.sql`. It matches both ID and original name, so it cannot rename a later customer workspace accidentally. The real customer workspace was not changed. The scheduler exclusion takes effect with the release containing it.

Future smoke checks should use the local D1 fixture. When a production-specific test is necessary, give the workspace this prefix at creation and avoid paid analysis or delivery to real recipients. Aggregate operator queries should exclude `workspaces.name LIKE '[TEST] %'`; customer views already isolate by workspace.
