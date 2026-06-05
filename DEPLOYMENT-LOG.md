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
| Production URL    | unknown — record here once confirmed                           |

## Deployment History

<!-- Newest entries first. No production deployments have been logged yet. -->

### YYYY-MM-DD — (template — replace with first logged deployment)

- **Date:**            YYYY-MM-DD HH:MM (timezone)
- **Commit:**          <commit hash>
- **Environment:**     production
- **Production URL:**  unknown
- **Deploy action:**   auto-deploy on push to master
- **Checks run:**      npm run check, npm run build
- **Rollback point:**  <last known-good commit hash>
- **Notes:**           Initial logged deployment.
