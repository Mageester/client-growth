# Backup and restore

D1 keeps 30 days of point-in-time history automatically ("Time Travel"), and
Cloudflare captures a bookmark when migrations are applied. That is a backup
system nobody has ever used, which is not yet a backup system. This runbook
exists so the first restore is not performed during the incident that needs it.

## Rehearse it before launch, then quarterly

Do this against a **scratch database**, never production. It takes ten minutes.

```bash
# 1. Make a throwaway database and give it the current schema.
wrangler d1 create client-growth-restore-drill
wrangler d1 migrations apply client-growth-restore-drill --remote

# 2. Put something in it you will recognise, and note the time.
wrangler d1 execute client-growth-restore-drill --remote \
  --command "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES ('ws_drill','Drill','u_drill','2026-01-01T00:00:00.000Z')"
date -u +%Y-%m-%dT%H:%M:%SZ

# 3. Destroy it the way a bad migration or a bad DELETE would.
wrangler d1 execute client-growth-restore-drill --remote \
  --command "DELETE FROM workspaces WHERE id = 'ws_drill'"

# 4. Find the bookmark for a moment before the damage.
wrangler d1 time-travel info client-growth-restore-drill --timestamp <the time from step 2>

# 5. Restore to it, and confirm the row is back.
wrangler d1 time-travel restore client-growth-restore-drill --bookmark <bookmark>
wrangler d1 execute client-growth-restore-drill --remote \
  --command "SELECT id FROM workspaces WHERE id = 'ws_drill'"

# 6. Clean up.
wrangler d1 delete client-growth-restore-drill
```

Record the date of the last successful drill at the bottom of this file. A drill
nobody has run this year is documentation, not a capability.

## Restoring production

**Restoring rewrites the database. Everything written after the bookmark is
gone.** For a mistake affecting one workspace, prefer exporting the good data
from a restored *copy* and re-inserting it, over rolling the whole service back
past every other tenant's work.

1. **Stop the writes.** Disable the cron trigger before anything else, or the
   scheduled monitoring tick will keep writing during the restore:
   `wrangler triggers deploy --env production` with the crons removed, or
   unset `MONITORING_TRIGGER_TOKEN` and remove the trigger in the dashboard.
2. **Find the moment.** `wrangler d1 time-travel info client-growth-production
   --env production --timestamp <ISO instant before the damage>`.
3. **Decide the blast radius.** Whole-database rollback, or restore into a new
   database and copy rows across? If more than one workspace has written since
   the damage, it is the second one.
4. **Restore.** `wrangler d1 time-travel restore client-growth-production
   --env production --bookmark <bookmark>`.
5. **Check the constraints held.** `wrangler d1 execute client-growth-production
   --env production --remote --command "PRAGMA foreign_key_check"` must return
   nothing.
6. **Check the migration ledger.** `pnpm db:migrations:production`. If the
   restore went back past a migration, re-apply.
7. **Put the cron back**, and confirm the next tick logs a `[monitoring]` line.

## What Time Travel does not cover

- **Anything older than 30 days.** There is no long-term archive. If one is
  needed, the workspace export (`/export/workspace`) is the format to keep.
- **Cloudflare account loss.** The database, the Worker and the DNS all live in
  one account. A periodic export stored elsewhere is the only answer to that.
- **A tenant deleting their own data.** That is a correct write, not damage, and
  it restores like any other.

---

Last successful restore drill: **never run**. Do this before the first paying
customer.
