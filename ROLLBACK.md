# Rollback Procedure — Fitzpatrick Warranty Service Tracker

This is a business-critical, daily-use application. If a deployment causes a
regression or outage, follow this procedure to return to a known-good state
quickly and safely.

**The GitHub repository is the source of truth.** Always identify the last
known-good commit or tag from GitHub before changing the running deployment.

---

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

This app deploys via **Render** (see `render.yaml`).

### Render — restore a previous deploy (fastest)

1. Log in to the Render dashboard and open the `fitzpatrick-service-tracker`
   service.
2. Open the **Events** / **Deploys** tab.
3. Find the last successful deploy that matches your known-good commit.
4. Choose **Rollback** / **Redeploy** for that deploy to restore it immediately.

### Render — redeploy after a code fix

1. Push the reverted/reset/tagged commit to `master` (Step 2).
2. Render auto-deploys on push. If auto-deploy is off, trigger a **Manual
   Deploy** of the desired commit from the dashboard.
3. Watch the build/start logs:
   - Build: `npm install && npm run build`
   - Start: `NODE_ENV=production node dist/index.cjs`

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

---

> Database note: rolling back code does **not** roll back database schema or
> data changes. If a deployment ran a migration (`npm run db:push`), confirm
> whether the schema is compatible with the rolled-back code before declaring
> recovery complete.
