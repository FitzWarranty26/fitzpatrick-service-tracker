# Deployment Log — Fitzpatrick Warranty Service Tracker

This file records every deployment to a hosted environment. This is a
business-critical, daily-use application, so each meaningful deploy should be
logged here for traceability and fast recovery.

Add a new entry at the **top** of the log for each deployment, using the
template below. Keep entries concise and factual.

## Deployment Template

Copy this block for each new deployment:

```
### YYYY-MM-DD — <short summary>

- **Date:**            YYYY-MM-DD HH:MM (timezone)
- **Commit:**          <full or short commit hash>
- **Environment:**     production | staging | preview
- **Production URL:**  <URL if known, otherwise "unknown">
- **Deploy action:**   <e.g. auto-deploy on push to master / manual redeploy / rollback>
- **Checks run:**      <e.g. npm run check (tsc), npm run build, manual smoke test>
- **Rollback point:**  <last known-good commit hash or tag to revert to>
- **Notes:**           <migrations, env var changes, risks, follow-ups>
```

## Environment Reference

| Field             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Provider          | Render (see `render.yaml`)                                     |
| Service name      | `fitzpatrick-service-tracker`                                  |
| Runtime           | Node                                                           |
| Build command     | `npm install && npm run build`                                 |
| Start command     | `NODE_ENV=production node dist/index.cjs`                      |
| Default branch    | `master`                                                       |
| Production URL    | https://warranty.fitzpatricksalescrm.com/#/ (confirmed 2026-06-11) |
| Auto-Deploy       | On Commit (confirmed by Kevin 2026-06-11)                      |
| Plan              | Starter (verified 2026-06-12 via Render dashboard; `render.yaml` reconciled to `starter` in the same change) |
| Persistent disk   | `/var/data`, **10 GB** (grown from 1 GB on 2026-06-12, Issue #4; ~14% used after grow). Holds `warranty_tracker.db` + on-disk backups. |
| DB_PATH           | `DB_PATH=/var/data/warranty_tracker.db` (verified live env var + shell 2026-06-12) |
| Internal address  | `fitzpatrick-service-tracker:10000`                            |

## Deployment History

### 2026-06-12 — Issue #27: commercial hosting decision (ADR 0001) (NO PRODUCTION DEPLOY)

- **Date:**            2026-06-12 (America/Denver)
- **Commit:**          n/a — docs/decision only
- **Environment:**     n/a — no deploy
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/
- **Deploy action:**   None. Recorded the commercial hosting platform decision.
- **Checks run:**      Documentation review only (per Issue #27).
- **Rollback point:**  Unchanged — `known-good-2026-06-12` → `e28492b`.
- **Notes:**           Decision: launch commercial DROVE on **Render (Express app) + Supabase (managed Postgres, RLS, Storage, Auth, mobile SDKs)**; **AWS = documented future scale-up target**. All business logic stays in Express; Supabase is managed infrastructure only. GitHub remains source of truth (CI gate / branch protection / rollback tags unchanged). Ties into Issue #7 (SQLite → Postgres). Full rationale + 5-platform comparison in `docs/adr/0001-commercial-hosting-platform.md`. Re-verify Render/Supabase pricing before committing spend.

### 2026-06-12 — Issue #6: rollback rehearsal + new known-good tag (NO PRODUCTION DEPLOY)

- **Date:**            2026-06-12 (America/Denver)
- **Commit:**          `e28492b` (current `master`, Merge PR #42)
- **Environment:**     n/a — Git + local sandbox only; production untouched
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/
- **Deploy action:**   None. Created rollback tag + rehearsed code rollback (Issue #6, option A).
- **Checks run:**      `npm run check` (tsc) ✅ and `npm run build` ✅ on rollback target `known-good-2026-06-05` (`44e91ce`); both exit 0.
- **Rollback point:**  **`known-good-2026-06-12` → `e28492b`** (new, recommended). Prior baseline `known-good-2026-06-05` → `44e91ce` re-verified deployable.
- **Notes:**           Created + pushed annotated tag `known-good-2026-06-12` on `e28492b`. Rehearsed Method 2 (Git tag redeploy) non-destructively: detached-HEAD checkout of `44e91ce`, clean `npm ci`, check + build pass, returned cleanly to `master`. Method 1 (Render native "Rollback to this deploy") documented in `ROLLBACK.md` §3; live Render drill deferred to avoid redeploying production. No database operations — live DB and backups untouched. See `ROLLBACK.md` §0 (targets) and §5a (rehearsal log).

<!-- Newest entries first. -->

### 2026-06-12 — Issue #4: automated backups + disk grow 1→10 GB — PRODUCTION CHANGE (approved)

- **Date:**            2026-06-12 (MDT)
- **Commits:**         `bb994b6` (PR #39 — add backup Cron Job to `render.yaml`),
                       `32d7f0b` (PR #40 — grow disk `sizeGB` 1→10). Docs in PR #41.
- **Environment:**     production
- **Deploy action:**   **Approved by Kevin (2026-06-12).** (1) Created a standalone
                       Render **Cron Job** `fitzpatrick-service-tracker-backup`
                       (`crn-d8m2sn28qa3s73b0uqm0`), image `curlimages/curl:8.11.0`,
                       schedule `0 6,18 * * *` UTC, command POSTs `/api/backup` with
                       the `x-backup-secret` header. (2) Grew the `/var/data`
                       persistent disk 1 GB → 10 GB in the Render dashboard (resize in
                       place; data preserved; service restarted to remount).
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS (PR #39/#40).
- **Rollback point:**  Code unchanged in app; `render.yaml` only. Web-service rollback
                       anchor remains `0d1f89b` / `0f67980`. Disk grow is one-way
                       (Render disks grow only, never shrink).
- **Backup/restore verification (Issue #4 acceptance criteria, 2026-06-12 via Web Shell):**
  - **Problem found & fixed:** the 1 GB disk was **97% full (30 MB free)** and a
    full backup pair (2 × ~464 MB) failed with **HTTP 500**, leaving an orphaned
    `backup-fri.db-journal` (removed). Root cause: retention keeps up to 9 copies
    (~4.6 GB) which never fit on 1 GB. Resolved by growing the disk to 10 GB.
  - **Backup test (post-grow):** `POST /api/backup` → `{"success":true,...}` writing
    `backup-pm.db` and `backup-fri.db`, each `486461440` bytes, same timestamp.
  - **Restore test (non-destructive):** copied newest backup to `/tmp`, opened
    read-only → `integrity_check: ok`, `service_calls` rows = **61**; scratch copy
    deleted; **live DB never touched.**
  - **Disk after grow:** `/var/data` 9.9 G size, 1.4 G used, 8.5 G avail, **14%**.
  - Backup procedure (health check, on-demand, non-destructive verify, and the
    DESTRUCTIVE restore steps) documented in `ROLLBACK.md` §6.
- **Notes:**           No secrets or customer data recorded here. The backup cron's
                       first scheduled run is 18:00 UTC (noon MDT). Backups live on
                       the **same disk** as the live DB — protects against bad
                       data/restarts, not total disk loss (off-disk backup = future
                       hardening).

### 2026-06-12 — render.yaml reconcile (PR #37) — PRODUCTION DEPLOY (approved & merged)

- **Date:**            2026-06-12 08:39 (MDT) — deploy live 08:40 MDT
- **Commit:**          `0d1f89b` (merge of PR #37 `fix/render-yaml-reconcile` into `master`)
- **Environment:**     production
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/
- **Deploy action:**   **Approved by Kevin (2026-06-12).** Merged PR #37 to `master`;
                       Render Auto-Deploy (On Commit) built and went live in ~1m29s.
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS;
                       `render.yaml` valid YAML. Post-deploy disk/DB integrity verified.
- **Rollback point:**  `0f67980` (previous production). Deeper baseline
                       `known-good-2026-06-05` → `44e91ce`.
- **What changed:**    `render.yaml` only (config-as-code) + docs. Blueprint now
                       declares `plan: starter`, the `/var/data` 1 GB persistent
                       disk, `DB_PATH=/var/data/warranty_tracker.db`, and
                       `BACKUP_SECRET` (`sync: false`). No application code changed.
- **Disk/DB integrity (read-only Render shell, immediately post-deploy):**
  - Disk still attached, `/var/data`, 1 GB, 48% used; 7 daily snapshots intact.
  - DB file `warranty_tracker.db` **byte-identical** to the pre-deploy baseline:
    size `479436800`, md5 `72f8c2be507a850c8caff0cf0a5c3065`, inode 13, Birth
    2026-03-25 (i.e. NOT recreated). Confirms the blueprint disk change was a
    no-op for storage and **no data was lost**.
- **Notes:**           No secrets or customer data recorded here.

### 2026-06-12 — Restart-survival test (Issue #3 acceptance criterion) — APPROVED MANUAL RESTART

- **Date:**            2026-06-12 09:14 (MDT)
- **Commit:**          `0d1f89b` (no code change; instance restart only)
- **Environment:**     production
- **Deploy action:**   **Approved by Kevin (2026-06-12).** One manual instance
                       **restart** via Render ("Service restarted by you", 09:14 MDT).
                       No redeploy, no config change.
- **Result:**          App returned healthy (HTTP 200; `/api/backup/status` 401 =
                       up + auth-protected). Persistent disk still attached at
                       `/var/data`, usage unchanged at 48% (458 MB), `DB_PATH`
                       unchanged, DB file present. Conclusion: **production data
                       survives an instance restart.** (Pre-restart redeploy in the
                       entry above was independently confirmed byte-identical by
                       md5.)
- **Post-restart confirmation (2026-06-12, Render Shell, fresh instance `925w6`):**
                       `stat -c %s /var/data/warranty_tracker.db` →
                       `479440896`; `md5sum` → `6cb84246f39c1f7d908e326acc224d9a`.
                       Versus the pre-deploy baseline (size `479436800`, md5
                       `72f8c2be507a850c8caff0cf0a5c3065`), the file is **+4096
                       bytes — exactly one SQLite page — larger**, with a changed
                       md5. This is normal active-write growth on a daily-use app,
                       **not data loss**: the DB persisted on the durable `/var/data`
                       disk across the restart onto a NEW instance and is
                       accumulating live records. Persistence confirmed healthy.
- **Rollback point:**  N/A (no code/config change).
- **Notes:**           No secrets or customer data recorded here. No fake records
                       were written to production.

### 2026-06-12 — Issue #3 persistence verification + render.yaml reconcile (NO PRODUCTION DEPLOY)

- **Date:**            2026-06-12 08:18 (MDT)
- **Commit:**          on branch `fix/render-yaml-reconcile` (PR, not merged)
- **Environment:**     none — **no production deploy.** Config-as-code + docs only;
                       does not change the running service.
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/ (unchanged; not redeployed)
- **Deploy action:**   **None.** Read-only verification of the live Render service
                       plus a reconciling edit to `render.yaml` and the continuity docs.
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS.
- **Rollback point:**  N/A (no deploy). Current production unchanged; `known-good-2026-06-05`
                       → `44e91ce` remains the baseline.
- **Verification (Issue #3, read-only via authenticated Render dashboard + shell, 2026-06-12):**
  - Plan: **Starter** (region Oregon; service `srv-d71fadcr85hc73a0i1cg`).
  - Env vars present: `NODE_ENV`, `DB_PATH=/var/data/warranty_tracker.db`,
    `BACKUP_SECRET` (set; value not recorded). No `DATABASE_URL`/`DATA_DIR`.
  - Persistent disk attached, mount path `/var/data`, 1 GB provisioned, ~458 MB
    used (48%), filesystem `/dev/nvme1n1`. 7 daily snapshots: Jun 5,6,7,8,9,10,11.
  - Shell: `echo $DB_PATH` → `/var/data/warranty_tracker.db`; `ls -la /var/data`
    shows `warranty_tracker.db` (~457 MB, modified same day) on the disk;
    `df -h /var/data` confirms `/var/data` is a mounted volume.
  - **Conclusion:** production data IS on durable storage and survives
    restarts/redeploys; snapshots provide point-in-time recovery.
- **Mismatch fixed in this change:** committed `render.yaml` previously declared
  `plan: free` with no `disk:` block and no `DB_PATH`/`BACKUP_SECRET`. It is now
  reconciled to `plan: starter` + `/var/data` 1 GB disk + `DB_PATH` +
  `BACKUP_SECRET (sync: false)` so the config is reproducible from the repo. This
  closes the from-blueprint risk where a rebuild would have started on an
  ephemeral filesystem with an empty database.
- **Notes:**           No secrets or customer data recorded here. Persistence was
                       verified, not changed.

### 2026-06-11 — Installation Review Notes — PRODUCTION DEPLOY (approved & merged to master)

- **Date:**            2026-06-11 11:09 (MDT)
- **Commit:**          merge of `feature/installation-review-notes` into `master`
                       (fast-forward; see master tip after this entry is committed)
- **Environment:**     production
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/
- **Deploy action:**   **Approved by Kevin ("Merge and deploy", 2026-06-11 11:09 MDT).**
                       Fast-forward merge of `feature/installation-review-notes` into
                       `master` and push to origin. Render Auto-Deploy = On Commit, so
                       the push to `master` triggers an automatic production deploy.
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS
                       (re-run on the deploy branch immediately before merge).
- **Rollback point:**  `8a6f7ac` (previous production / PR #1 merge). Deeper baseline
                       `known-good-2026-06-05` → `44e91ce`. See `ROLLBACK.md`.
- **Notes:**           Supersedes the NO-DEPLOY entry below. Adds the additive nullable
                       `installation_review_notes` column (Migration 32, idempotent
                       `columnExists` guard); the migration runs at startup on deploy
                       and does not affect existing rows. Installation Review Notes are
                       excluded from printed/emailed reports by default (opt-in toggle).
                       No env-var changes. No secrets or customer data recorded here.
                       Post-deploy: confirm Render build succeeded and run the manual
                       smoke test in the handoff checklist.

### 2026-06-11 — Installation Review Notes feature (NO PRODUCTION DEPLOY)

- **Date:**            2026-06-11 (MDT)
- **Commit:**          on feature branch `feature/installation-review-notes` (not merged)
- **Environment:**     none — **no production deploy was performed**
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/ (unchanged; not redeployed)
- **Deploy action:**   **None.** Feature implemented on a branch only. Not merged to
                       `master`, so the Render auto-deploy-on-commit was NOT triggered.
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS.
- **Rollback point:**  N/A (no deploy). Pre-existing known-good remains
                       `44e91ce` / current production `8a6f7ac`.
- **Notes:**           Adds an additive nullable `installation_review_notes` column
                       (Migration 32, idempotent `columnExists` guard). On the next
                       deploy the migration runs at startup; existing rows are
                       unaffected. Installation Review Notes are excluded from
                       printed/emailed reports by default with an opt-in toggle.
                       **Awaiting Kevin review before any merge/deploy.** No secrets
                       or customer data recorded here.

### 2026-06-11 — First confirmed production deployment (PR #1 / commercial-readiness)

- **Date:**            2026-06-11 08:50 (MDT)
- **Commit:**          8a6f7ac7782e0c00270b1f4b0b490b80094f90f5 (merge of PR #1)
- **Environment:**     production
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/ (confirmed reachable)
- **Deploy action:**   Manual Render deployment, confirmed by Kevin via authenticated
                       Render dashboard. **Result: succeeded.**
- **Auto-Deploy:**     On Commit (enabled) — pushes/merges to `master` will trigger
                       a Render deploy automatically.
- **Plan:**            Starter (note: `render.yaml` still declares `plan: free`; the
                       live service is on Starter per Kevin — reconcile separately).
- **Checks run:**      Docs-only record. No build/check run for this log entry.
                       Application code was deployed as merged in PR #1.
- **Rollback point:**  known-good-2026-06-05 → 44e91ce6b267c119290a5998455877e426a33008
- **Source PR:**       https://github.com/FitzWarranty26/fitzpatrick-service-tracker/pull/1
- **Persistent disk:** Confirmed via Render screenshot (2026-06-11): a persistent
                       disk is attached to web service `fitzpatrick-service-tracker`,
                       mount path `/var/data`, size 1 GB (usage 1 GB), with a
                       snapshot visible dated 2026-06-10 18:16. Service shown as
                       Node Starter, repo FitzWarranty26/fitzpatrick-service-tracker
                       on `master`, domain warranty.fitzpatricksalescrm.com, internal
                       address `fitzpatrick-service-tracker:10000`.
- **Notes:**           **Remaining risk:** a disk being attached does not guarantee
                       SQLite is using it — verify the application database file is
                       actually stored under `/var/data` (not on the ephemeral
                       filesystem). See `COMMERCIAL-READINESS-CHECKLIST.md` §3. No
                       secrets or customer data recorded here.

### YYYY-MM-DD — (template — replace with first logged deployment)

- **Date:**            YYYY-MM-DD HH:MM (timezone)
- **Commit:**          <commit hash>
- **Environment:**     production
- **Production URL:**  unknown
- **Deploy action:**   auto-deploy on push to master
- **Checks run:**      npm run check, npm run build
- **Rollback point:**  <last known-good commit hash>
- **Notes:**           Initial logged deployment.
