# Rollback Procedure — Fitzpatrick Warranty Service Tracker

This is a business-critical, daily-use application. If a deployment causes a
regression or outage, follow this procedure to return to a known-good state
quickly and safely.

**The GitHub repository is the source of truth.** Always identify the last
known-good commit or tag from GitHub before changing the running deployment.

---

## 0. Known-good rollback targets (tags)

These tags mark commits verified healthy in production. Newest first — prefer
the newest tag that predates the problem you are recovering from.

| Tag | Commit | Verified | Notes |
| --- | ------ | -------- | ----- |
| `known-good-2026-06-12` | `e28492b` | 2026-06-12 | `master` after PR #42 (CI gate, Issue #5). CI green; backups operational on 10 GB disk. **Current recommended target.** |
| `known-good-2026-06-05` | `44e91ce` | 2026-06-05 | Original Phase 0 baseline. Re-verified deployable 2026-06-12 (`npm run check` + `npm run build` pass). |

```bash
# List all tags newest-first
git tag --list --sort=-creatordate
# Resolve a tag to its commit
git rev-list -n1 known-good-2026-06-12
```

When you create a new known-good state, **add a tag and a row here** (see
§5 and the Future Work Protocol in `RECOVERY-INDEX.md`).

## 1. Identify the last known-good state

1. Open the commit history:
   `https://github.com/FitzWarranty26/fitzpatrick-service-tracker/commits/master`
2. Cross-reference `DEPLOYMENT-LOG.md` to find the most recent entry whose
   **Rollback point** / commit was confirmed healthy in production.
3. Note that commit hash (or tag). This is your rollback target.

```bash
# View recent history with hashes
git log --oneline -20

# Inspect tags (rollback points for major releases)
git tag --list --sort=-creatordate
```

## 2. Roll back the code in GitHub

Choose the option that fits the situation.

### Option A — Revert (preferred; preserves history)

Use when you want an auditable, forward-moving fix that undoes the bad change.

```bash
git checkout master
git pull origin master

# Revert a single bad commit
git revert <bad-commit-hash>

# ...or revert a range (oldest first), e.g. a bad merge
git revert <oldest-bad>^..<newest-bad>

git push origin master
```

### Option B — Reset to a known-good commit (use with caution)

Use only when a clean rewind is required and you understand it rewrites the
branch. Coordinate before force-pushing a shared branch.

```bash
git checkout master
git reset --hard <known-good-commit-hash>
git push --force-with-lease origin master
```

### Option C — Redeploy from a tag

If major releases are tagged (see Future Work Protocol in `RECOVERY-INDEX.md`),
deploy the tagged commit directly:

```bash
git checkout <tag-name>
```

## 3. Restore / redeploy on the deployment provider

This app deploys via **Render** (see `render.yaml`). There are **two rollback
methods** — use the decision guide, then follow the matching method.

**Which method?**

| Situation | Use |
| --------- | --- |
| Need production healthy **right now**; the bad change is already deployed; you don't yet have a code fix | **Method 1 — Render native rollback** (fastest; no Git push, no rebuild) |
| You want an **auditable, permanent** fix in Git, or the bad deploy will keep re-deploying from `master` until the code is corrected | **Method 2 — Git revert/tag + redeploy** (combine with §2) |

> In practice: **Method 1 to stop the bleeding immediately, then Method 2** to
> make the fix permanent in `master` (otherwise the next push could redeploy the
> bad code). Method 1 alone is temporary — Render's auto-deploy on `master` will
> overwrite it on the next push.

### Method 1 — Render native rollback (fastest, no rebuild)

Render keeps every past successful deploy and can re-activate one instantly
(it re-serves the already-built image; no new build runs).

1. Log in to the Render dashboard → open the **`fitzpatrick-service-tracker`**
   web service (`srv-d71fadcr85hc73a0i1cg`).
2. Open the **Events** tab (or **Deploys**). You'll see the deploy history with
   commit hashes and timestamps.
3. Find the last **Live**/successful deploy that matches a known-good commit
   (cross-reference §0 tags and `DEPLOYMENT-LOG.md`).
4. Click that deploy → use the **⋮ / Rollback to this deploy** action (Render
   labels it "Rollback" on the deploy's menu). Confirm.
5. Render re-activates that build. Watch it go **Live**, then run §4 Verify.

> ⚠️ This does **not** change `master`. The code in GitHub is still the bad
> version, so the **next push to `master` will auto-deploy the bad code again.**
> Always follow up with Method 2 to correct `master`.

### Method 2 — Git revert/tag + redeploy (permanent fix)

This corrects `master` so the good code is what auto-deploys.

1. Roll back the code in Git using **§2** — prefer **Option A (revert)** for an
   auditable forward fix, or **Option C (redeploy from a known-good tag)** such
   as `known-good-2026-06-12` (see §0).
2. Open a PR and let **CI** (`check-and-build`) pass, then merge to `master`.
   (Branch protection requires a green CI run before merge — see
   `RECOVERY-INDEX.md`.)
3. Render auto-deploys on the merge to `master`. If auto-deploy is off, trigger
   a **Manual Deploy** of the desired commit/tag from the dashboard.
4. Watch the build/start logs:
   - Build: `npm install && npm run build`
   - Start: `NODE_ENV=production node dist/index.cjs`

> Emergency exception: if production is down and you cannot wait for CI, you may
> use §2 Option B (reset + `--force-with-lease`) to rewind `master` directly.
> This bypasses the PR/CI gate — do it only in a genuine emergency and record it
> in `DEPLOYMENT-LOG.md`.

### Generic provider (if not Render)

1. Open the hosting provider's dashboard for this service.
2. Use its deploy/release history to **roll back** to the previous successful
   release, **or** trigger a new deploy pinned to the known-good commit/tag.
3. Confirm the running version matches the intended commit.

## 4. Verify recovery

- [ ] Application loads and the login page is reachable.
- [ ] Core workflow works (e.g. view service calls, open a record).
- [ ] No errors in the provider's runtime logs.
- [ ] The running version matches the intended known-good commit/tag.

## 5. Record the rollback

1. Add a new entry to `DEPLOYMENT-LOG.md` describing the rollback (date, target
   commit, action taken, outcome).
2. If the root cause is known, note it in `CHANGELOG.md` under `[Unreleased]`
   and open or update a GitHub issue using the bug report template.

## 5a. Rollback rehearsal log (Issue #6)

Record rehearsals here so we know the procedure has been exercised and the
targets are deployable.

### 2026-06-12 — Code-rollback dry-run (non-destructive; no production touched)

- **Performed by:** Perplexity Computer (for Kevin Withers). Approach: paper +
  code dry-run only (option A) — production was **not** redeployed.
- **Targets verified:**
  - `known-good-2026-06-12` → `e28492b` created and pushed (current recommended
    target).
  - `known-good-2026-06-05` → `44e91ce` (existing baseline) checked out in a
    detached HEAD and re-verified deployable.
- **Method 2 (Git tag) rehearsed:** `git checkout known-good-2026-06-05` →
  `npm ci` → `npm run check` (tsc) **passed (exit 0)** → `npm run build`
  **passed (exit 0)**. Returned cleanly to `master` (`e28492b`), working tree
  clean. This proves the documented tag-redeploy path produces a deployable
  build.
- **Method 1 (Render native rollback):** documented and ready (§3 Method 1); a
  live click-through drill on Render was intentionally deferred to avoid
  redeploying production. Recommended as a future scheduled exercise.
- **Data safety:** no database operations were performed; the live SQLite DB
  and backups were never touched.

---

## 6. Database backup & restore (Issue #4)

> **Code rollback does NOT undo data or schema changes.** Reverting a commit
> rewinds application code only. The SQLite database on the persistent disk is
> unaffected by a code rollback. If a bad deploy corrupted or wrongly mutated
> data, you must restore the database from a backup (below) **in addition to**
> rolling back code. If a deploy ran a migration (`npm run db:push`), confirm
> the schema is compatible with the rolled-back code before declaring recovery
> complete.

### How backups work

| Item | Value |
| ---- | ----- |
| Mechanism | `POST /api/backup` uses SQLite's `.backup()` API — a safe, consistent copy even during concurrent writes. |
| Frequency | **Every 12 hours** via a Render **Cron Job** (`fitzpatrick-service-tracker-backup`, `crn-d8m2sn28qa3s73b0uqm0`), schedule `0 6,18 * * *` UTC (06:00 / 18:00 UTC = midnight / noon America/Denver MDT). |
| Storage location | The same persistent disk as the live DB: `/var/data` on the Render service `srv-d71fadcr85hc73a0i1cg`. Disk size **10 GB** (grown from 1 GB on 2026-06-12 — Issue #4). |
| Files (retention) | Two half-day slots `backup-am.db` / `backup-pm.db` (overwritten each half-day) **plus** seven day-of-week slots `backup-mon.db` … `backup-sun.db` (overwritten weekly). Effective retention: **~7 days**, plus the current AM/PM pair. |
| Owner | Kevin Withers / Fitzpatrick Warranty Service, LLC. The Render Cron Job is the responsible automation. |
| Auth | `BACKUP_SECRET` env var, sent as the `x-backup-secret` **header** (never a query string). The cron job and the web service must share the same secret value. |

> ⚠️ **Single-disk caveat:** backups live on the **same disk** as the live
> database. This protects against accidental data mutation, bad migrations, and
> instance restarts/redeploys (the disk persists across those). It does **NOT**
> protect against total loss of the disk itself. Off-disk/cloud backup is
> tracked as future hardening; today, pull a periodic copy off-box if you need
> disaster-grade durability.

### Check backup health (read-only)

From the Render **Web Shell** of the `fitzpatrick-service-tracker` web service:

```bash
# List backup files + the live DB with sizes and timestamps (via the app)
curl -sS -H "x-backup-secret: $BACKUP_SECRET" http://localhost:10000/api/backup/status; echo

# Or look directly on the disk
ls -la "$(dirname "$DB_PATH")"/backup-*.db
df -h "$(dirname "$DB_PATH")"   # confirm free space
```

You can also confirm the cron job's last run in the Render dashboard
(`fitzpatrick-service-tracker-backup` → run history). A failed run shows red
because the curl command uses `--fail`.

### Trigger an on-demand backup

From the web service Web Shell:

```bash
curl -sS -X POST -H "x-backup-secret: $BACKUP_SECRET" http://localhost:10000/api/backup; echo
# Expect: {"success":true,"backups":[{"file":"backup-XX.db",...},{"file":"backup-DAY.db",...}]}
```

Or click **Trigger Run** on the `fitzpatrick-service-tracker-backup` cron job in
the Render dashboard.

### Verify a backup is restorable BEFORE relying on it (non-destructive)

This proves a backup file is a valid, openable database **without touching the
live DB.** Run in the web service Web Shell:

```bash
N=$(ls -t "$(dirname "$DB_PATH")"/backup-*.db | head -1)   # newest backup
cp "$N" /tmp/restore_test.db
node -e "const D=require('better-sqlite3');const d=new D('/tmp/restore_test.db',{readonly:true});console.log('integrity:',d.pragma('integrity_check',{simple:true}));console.log('service_calls rows:',d.prepare('SELECT count(*) c FROM service_calls').get().c);d.close()"
rm -f /tmp/restore_test.db   # delete scratch copy; live DB never touched
```

Expect `integrity: ok` and a sensible row count. (Verified 2026-06-12:
`integrity: ok`, 61 service_calls rows.)

### RESTORE the live database from a backup (DESTRUCTIVE — last resort)

> 🛑 This **overwrites the live database.** Only do this for genuine data loss
> or corruption, with deliberate approval. Always keep a copy of the current
> (bad) DB first so the operation is reversible.

1. **Pick the backup to restore from.** Newer is usually better, but if the
   corruption is recent, choose a day-of-week file from *before* the bad event
   (e.g. `backup-thu.db`). Verify it first with the non-destructive check above.
2. **Stop writes.** In the Render dashboard, **suspend** the web service (or
   scale to 0) so no new writes hit the DB during the swap. The backup cron can
   stay; it will simply fail while the service is down.
3. **Open the Web Shell** of the web service (you may need to resume it briefly
   in maintenance, or use a one-off shell) and run:

   ```bash
   DIR=$(dirname "$DB_PATH")
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   # 1) Preserve the current (suspect) DB so this is reversible
   cp "$DB_PATH" "$DIR/warranty_tracker.PRE_RESTORE_$TS.db"
   # 2) Remove any stale WAL/journal side files
   rm -f "$DB_PATH-wal" "$DB_PATH-shm" "$DB_PATH-journal"
   # 3) Overwrite the live DB with the chosen backup (example: Thursday)
   cp "$DIR/backup-thu.db" "$DB_PATH"
   # 4) Sanity-check the restored DB
   node -e "const D=require('better-sqlite3');const d=new D(process.env.DB_PATH,{readonly:true});console.log('integrity:',d.pragma('integrity_check',{simple:true}));console.log('service_calls rows:',d.prepare('SELECT count(*) c FROM service_calls').get().c);d.close()"
   ```

4. **Resume / restart** the web service. Confirm it loads, login works, and
   recent records look correct (see §4 Verify recovery).
5. **Record the restore** in `DEPLOYMENT-LOG.md` (date, which backup file,
   reason, row counts before/after). If data between the backup and the
   incident was lost, note the gap.
6. Once confident, you may delete the `warranty_tracker.PRE_RESTORE_*.db`
   safety copy to reclaim disk space.

---

> Database note: rolling back code does **not** roll back database schema or
> data changes. If a deployment ran a migration (`npm run db:push`), confirm
> whether the schema is compatible with the rolled-back code before declaring
> recovery complete.
