# DROVE Roadmap — Single Working Document

> **This file is the single working roadmap for DROVE** (commercial brand of the
> Fitzpatrick Warranty Service Tracker). It supersedes the April 2026
> "Commercial Launch Roadmap" PDF (retired 2026-07-17). GitHub — this file plus
> the issue tracker — is the source of truth. Update this file whenever phases,
> priorities, or scope change.

**Last updated:** 2026-07-17 · **Owner:** Kevin Withers
**Companion docs:** [`docs/CODE-REVIEW-2026-07-17.md`](docs/CODE-REVIEW-2026-07-17.md) (full findings) ·
[`docs/adr/0001-commercial-hosting-platform.md`](docs/adr/0001-commercial-hosting-platform.md) ·
`COMMERCIAL-READINESS-CHECKLIST.md` · `RECOVERY-INDEX.md`

---

## Current production state (2026-07-17)

- App: https://warranty.fitzpatricksalescrm.com · Render Starter, auto-deploy on `master` merge.
- Stack: Express 5 + React 18 + Drizzle + better-sqlite3 on Render persistent disk.
- Recent deploys: PR #61 + #65 (description-wipe fix + class-kill hardening, 07-16), PR #67 (photo 413 body-limit fix, 07-17). Deploy log: PRs #63, #66, #68.
- **Open loose ends:**
  - [x] PR #62 (read-only blank-description blast-radius diagnostic) — reviewed and **closed** 2026-07-19 (S7); the fixes it scoped (#61/#65) are live, script preserved on its branch.
  - [ ] Data cleanup: service calls **#41, #85, #86** have blank descriptions from the buggy path (text unrecoverable — re-enter from field knowledge, then note in the call activity log). **Kevin-only** (field knowledge).
  - [ ] Issue #64 open: remove legacy dual-storage + `syncLegacyFromProduct` (folded into Phase 1 below).

## Architecture decisions in force

- **ADR-0001:** Launch on **Render + Supabase** (Postgres, RLS, Storage, Auth). Express app and business logic stay intact. AWS documented as the future scale-up target.
- **ADR-0002 (2026-07-17):** **Stripe** is the payments/billing provider for both revenue streams — Stripe Billing for DROVE subscriptions (#11) and **Stripe Connect Standard accounts + application fees** for tenant invoice payments with a platform take-rate (#24). Take-rate priced in the Jobber/Housecall Pro/ServiceM8 band (~0.2%–1% over Stripe cost; finalized with #28). Mobile: invoice payments are Apple-IAP-exempt (Guideline 3.1.3(e)); subscriptions sold on the web only (#29). Re-evaluate a buy-rate payfac (Rainforest) if platform volume passes ~$5M/yr.
- **ADR-0003 (2026-07-17):** Mobile apps are built with **React Native + Expo** — Capacitor is dropped. Scope is a purpose-built **Technician App** (~8–12 screens: today's jobs, call detail, photos, parts, invoicing, payment collection, offline queue); the browser app remains the office/admin product. Shared core package (types, zod schemas, API client, query functions) consumed by both clients. Chosen because Tap to Pay is strategic and only React Native has the official first-party Stripe Terminal SDK; same stack as Jobber/ServiceTitan. Apply for Apple's Tap to Pay entitlement early.
- **Postgres migration (Issue #7) decisions (2026-06-12):** convert TEXT-stored fields to proper types (`numeric`, `timestamp`, `boolean`); move photos from base64-in-DB to Supabase Storage during the migration; test via local throwaway Postgres → Supabase US-region test project → production cutover; multi-tenant RLS is a separate, later step.

---

## Phase 0.5 — Hardening sprint (NEW, from the 2026-07-17 code review)

**Goal:** kill the three standing bug generators (dual-written data, unvalidated
boundaries, no test net) and the cheap critical fixes **before** the Postgres
migration, so we migrate clean data with a safety net instead of migrating bugs.

**Rule for every item:** own branch → `npm run check` + `npm run test` + `npm run build` → PR → Kevin merges (merge = deploy). Update CHANGELOG/DEPLOYMENT-LOG per playbook.

### Weekend plan — Saturday 2026-07-18 (quick wins, ~7 small PRs)

Ordered so each step de-risks the next. Review-finding IDs refer to `docs/CODE-REVIEW-2026-07-17.md`.

- [x] **S1. CI runs tests** (server H2, S): added `npm test` step to `.github/workflows/ci.yml` (runs before build); `test` script widened to `tsx --test server/*.test.ts`. PR #77, merge `ba5b9bc`, deployed 2026-07-19.
- [x] **S2. Enforce foreign keys** (server C4, S): `foreign_keys = ON` enabled at startup **only** behind a read-only orphan-audit gate (fail-open if orphans exist). New `server/orphan-audit.ts` + `scripts/audit-orphans.mjs` (Render-Shell runnable) + 4 tests. PR #78, merge `fc83e41`, deployed 2026-07-19.
- [x] **S3. Fix `deleteServiceCall`** (server C3, S): wrapped in a transaction and now deletes `invoice_items` for the call's invoices; regression test proves no orphans remain. PR #79, merge `b1b27a2`, deployed 2026-07-19.
- [x] **S4. Manager-gate service-call deletion** (server H4, S): `requireManager` on `DELETE /api/service-calls/:id`; guards extracted to `server/auth-guards.ts` + tests. Soft-delete still deferred. PR #80, merge `b252acd`, deployed 2026-07-19.
- [x] **S5. Delete the three `*.legacy.tsx` pages + routes** (client H2, S): removed ~4,000 lines + their routes/imports (`App.tsx`). PR #81, merge `b97cae6`, deployed 2026-07-19.
- [x] **S6. Seeded admin credentials** (server H6, S): password now from `SEED_ADMIN_PASSWORD` or crypto-random, never logged; `must_change_password` kept; existing prod users untouched. PR #82, merge `39ae074`, deployed 2026-07-19.
- [x] **S7. Loose ends:** PR #62 reviewed and **closed** 2026-07-19 (fixes it scoped are live). **Still pending (Kevin-only):** re-enter descriptions for calls #41/#85/#86 from field knowledge.

### Weekend plan — Sunday 2026-07-19 (boundaries + money)

- [ ] **S8. Zod validation on raw-body routes** (server H1, M): `validate(schema)` middleware using the existing drizzle-zod schemas; apply to users, invoices, visits, appointments routes; 400 on failure.
- [ ] **S9. Server-derived invoice totals** (client C1, M): server computes `subtotal`/`total` (and line amounts) from persisted line items on create/update; ignore client totals; test with golden values. *This is a billing-integrity prerequisite for any paid tenant.*
- [ ] **S10. Client error-handling batch** (client M1/M2/H3, each S): try/catch around the NewServiceCall parts loop; `onError` toasts on delete/reorder mutations; 300 ms debounce on service-call search.

### Next 1–2 weeks (before/with the Postgres migration)

- [ ] **Sessions + rate limits to a shared store** (server C2, M–L): DB-backed sessions (Postgres table once migrated); fixes deploy-logout and enables multi-instance. Pair with client H1 (session survives reload — httpOnly cookie preferred).
- [ ] **Versioned migrations** (server H5, L): drizzle-kit generated SQL migrations run as a pre-deploy step; move seed data out of `storage.ts`.
- [ ] **Issue #64 — remove dual-storage + `syncLegacyFromProduct`** (L): single source of truth for narrative fields; migrate readers (reports, equipment search); schema migration with tested rollback. *Sequence with Issue #7 so the Postgres schema is born clean, without the legacy columns.*
- [ ] Reconcile `SERVICE_STATUSES` enum vs SQL (`'Needs Return Visit'`) (server M6, S).
- [ ] Standardize React Query keys; reset `expiredHandled` on login (client M5/L1, S).

---

## Phase 1 — Foundation: Postgres + tenancy (Issues #7–#10)

- [ ] **#7** Migrate data layer SQLite → PostgreSQL (Supabase) — proper types, photos → Supabase Storage, hybrid test approach. Use the code review's SQLite-idiom checklist (server M1: `julianday`, `datetime('now')`, `CAST AS REAL`, `lastInsertRowid`, `.backup()`).
- [ ] **#8** Company/tenant model + tenant-scoped data access — `tenant_id` NOT NULL on every table; composite uniqueness (`users.username`, `invoices.invoice_number`); enforce in a storage-layer wrapper; RLS as defense-in-depth (per June decision, RLS lands after the base migration).
- [ ] **#9** Uploads to tenant-safe cloud storage (Supabase Storage, per-tenant key prefixes, signed URLs).
- [ ] **#10** Auth upgrades: password reset, invitations, session scoping. (Absorbs the shared-store session work above.)
- [ ] Tenant/branding config + tenant-scoped lookup tables (client H4): company name, logo, invoice-from block, manufacturers, warranty rules, states, tax rate. Client reads config at login instead of hardcoded constants.
- [ ] Invoice tax line, tenant-configurable (client M4 — rolls up with S9).

## Phase 2 — Billing & onboarding (Issues #11, #12, #28, #29)

- [ ] **#11** Stripe subscription billing, trial, plan enforcement (per ADR-0002) · **#12** company onboarding wizard · **#28** pricing/packaging final (includes take-rate pricing per ADR-0002) · **#29** app-store billing policy (posture decided in ADR-0002: web-only subscription sales; in-app invoice payments IAP-exempt).

## Phase 3 — Tenant configuration (Issues #13, #14, #25)

- [ ] **#13** tenant settings (branding, manufacturers, warranty defaults) · **#14** plan-based feature gating · **#25** QuickBooks Online integration MVP.

## Phase 3.5 — DROVE brand system & rebrand (Issue #36)

- [ ] Replace Fitzpatrick branding app-wide per DROVE brand guidelines (logos/colors in the Space brand document). Depends on tenant/branding config (Phase 1) so the rebrand is config, not another hardcode.

## Phase 4 — Field-service features (Issues #15–#19)

- [ ] **#15** navigation reorg · **#16** dispatch board · **#17** mobile technician workflow · **#18** estimates & quote approval · **#19** customer notifications. (April feature-plan PDF remains the design reference for these.)
- **Field ↔ office sync architecture (note):** DROVE is server-authoritative — the phone/iPad Technician App (Expo React Native, Phase 5, per ADR-0003) and office browsers are both clients of the *same* API and database, so there is no device-to-device sync and no second data store. What field techs do is visible to the office as soon as the office view refetches. Work items to make this feel live and field-proof:
  - [ ] Offline queue for no-signal jobsites (web today: `client/src/lib/offline-queue.ts`, `sync-service.ts`; RN equivalent in the Technician App): replay ordering, retry/backoff, conflict handling via the existing If-Unmodified-Since/409 guard, and photo background upload. (Rolls into #17.)
  - [ ] Live office updates: short-interval React Query refetch on dispatch/list views now; evaluate Supabase Realtime (Postgres change streams) after the Phase 1 migration for push-style updates on the dispatch board (#16).
  - [ ] Extract the shared core package (`@drove/core`: domain types, zod schemas, API client, TanStack Query functions, money/date utilities) consumed by web + Technician App (per ADR-0003). Pairs naturally with hardening item S8 (zod boundaries).

## Phase 5 — Launch prep & mobile (Issues #20–#23, #30–#35)

- [ ] **#20** monitoring/error tracking/alerts · **#21** help center · **#22** legal docs · **#23** marketing site · **#30–#35** **Expo React Native Technician App** (per ADR-0003), store releases, permissions, account deletion, TestFlight/Play testing · Apple **Tap to Pay entitlement application** early in this phase (lead time: form + demo video).

## Phase 6 — Payments & operator tooling (Issues #24, #26)

- [ ] **#24** Stripe Connect invoice payments — **Connect Standard hosted onboarding + application fees** per ADR-0002 · **#26** operator admin dashboard (tenants, MRR, churn).

---

## Retired / reference documents

| Document | Status |
|---|---|
| April 2026 "Commercial Launch Roadmap" PDF | **Retired 2026-07-17** — superseded by this file. Business/pricing content remains historically useful; where it conflicts with this file or ADR-0001 (e.g. Cloudflare R2 vs Supabase Storage), this file wins. |
| April 2026 Feature Plan PDF (dispatch/estimates/notifications) | Reference for Phase 4 feature design. |
| DROVE brand guidelines (Space file) | Authoritative for logos/branding (Phase 3.5). |
| `COMMERCIAL-READINESS-CHECKLIST.md` | Still active for ops/infrastructure verification items. |

## Working rules

1. GitHub is the source of truth; Perplexity pins/recents/memory are not.
2. Every change: branch → checks → PR → explicit merge approval. Merge to `master` auto-deploys.
3. Update `CHANGELOG.md` / `DEPLOYMENT-LOG.md` / `RECOVERY-INDEX.md` after meaningful work.
4. Update **this file** when scope or sequencing changes; new work items become GitHub issues linked here.
5. Never paste or invent customer personal data, credentials, or secrets.
