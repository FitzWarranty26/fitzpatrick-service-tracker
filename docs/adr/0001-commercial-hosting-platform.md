# ADR 0001 — Commercial Hosting Platform for DROVE

- **Status:** Accepted
- **Date:** 2026-06-12
- **Decision owner:** Kevin Withers (Fitzpatrick Sales / Fitzpatrick Warranty Service, LLC)
- **Tracked by:** Issue #27 (Phase 0 — Production Safety and Hosting Decision)
- **Related:** Issue #7 (Phase 1 — migrate SQLite → PostgreSQL)

> ADRs are short, durable records of significant architecture decisions. They
> capture the context, the decision, and the consequences so future readers
> (human or agent) understand *why* the system is the way it is. Supersede an
> ADR with a new one rather than rewriting history.

---

## Context

DROVE is being repositioned from an internal warranty-service tracker into a
**commercial, subscription-based SaaS for service contractors** (plumbing,
HVAC, electrical, etc.), with **browser + future iOS/Android clients**. That
changes the hosting requirements materially versus an internal tool:

- **Multi-tenancy** — many contractor companies, with strong data isolation.
- **Mobile clients** — iOS/Android (native and/or PWA), needing a stable API,
  auth, file/photo upload from the field, and push notifications.
- **Subscription billing** (Stripe), auth at scale, per-tenant isolation.
- **Durability & recovery** — managed PostgreSQL with point-in-time recovery
  (PITR), off-disk object storage for photos, and a credible reliability story
  we can stand behind in a sales conversation.
- **US data residency** preferred.
- **Operated by a 16-person firm** where the owner is currently the de facto
  ops person, open to hiring DevOps help later — so **operational burden is a
  first-class evaluation axis**.
- **Balanced priority** — neither pure speed-to-launch nor maximum
  future-proofing; the best long-run value that is realistic to operate today.

The app is currently Node.js/Express + React on **Render**, using **SQLite on a
single Render persistent disk**. The known weakness (see `ROLLBACK.md` §6) is
that backups live on the *same disk* as the live database — no protection
against total disk loss and no PITR. Issue #7 plans the SQLite → PostgreSQL
migration. **This hosting decision and the Issue #7 migration are the same
decision in practice: it determines where the managed Postgres, the app, and
the photo storage will live.**

---

## Options considered

Five platforms were evaluated (June 2026) across managed PostgreSQL, backups /
PITR, object storage, multi-tenancy fit, mobile support, compliance, uptime /
SLA, monitoring, support, pricing predictability, and operational burden. Full
research with source URLs is summarized below; the underlying notes were
gathered from each vendor's official documentation and pricing pages.

### Summary matrix

| Dimension | Render | Railway | Fly.io | AWS | Supabase (+ app host) |
| --- | --- | --- | --- | --- | --- |
| Managed Postgres | Fully managed, HA, read replicas | "Unmanaged" container, no managed upgrades | Managed (since 2025) | RDS / Aurora (best-in-class) | It *is* Postgres, per-project |
| PITR | 3-day (Pro) / 7-day (Scale) | 4-week (Pro, mid-2026) | **Not yet available** | **Any second, up to 35 days** | Add-on ($100–300/mo) |
| Object storage (photos) | None native — use S3 / R2 | Buckets (free egress) | Tigris (zero egress) | S3 (11-nines durability) | Storage + CDN + image transforms |
| Multi-tenant / RLS | Documented < 10k tenants | Templates (but see incident) | Supported | Effectively unlimited | **RLS is its signature strength** |
| Mobile (iOS/Android) | API only; push external | API only; push external | API only; edge latency | Cognito + SNS push + Amplify | **Native Swift/Kotlin/RN/Flutter SDKs** |
| Compliance | SOC 2 + ISO 27001 | SOC 2/3; HIPAA (Ent. only) | SOC 2 II; HIPAA ($99/mo) | Everything (SOC 2, HIPAA, PCI, FedRAMP) | SOC 2 II + ISO 27001 |
| Uptime / SLA | No published % (~98.8% tracked) | 99.999% *target*, no credits | 99.99% measured; SLA on Enterprise | 99.95–99.99% contractual | No SLA below Enterprise |
| Pricing predictability | Mostly flat (bandwidth = risk) | Usage-based, no billing alerts | Usage-based, no billing alerts | Famously unpredictable | Flat + spend caps on by default |
| Ops burden (owner) | Low | Low–Medium | Medium (Postgres ops) | **High: 40–80h setup, 5–10 h/wk** | Low–Medium |
| ~Monthly (small prod) | ~$150–200 | ~$105–110 | ~$120–150 | ~$148–350 | ~$25–155 + app host $7–25 |

### Notable 2026 facts that shaped the decision

- **AWS App Runner was discontinued to new customers (April 30, 2026).** The
  modern AWS PaaS-like path is now **ECS Express Mode**.
- **Fly.io now offers fully Managed Postgres** (replacing the old Supabase
  partnership, April 2025) — but **PITR is not yet available** on it.
- **Railway shipped true PITR (mid-2026, 4-week window)** but still labels its
  Postgres "unmanaged" (no managed major-version upgrades).
- **Railway had two serious 2026 incidents**: an ~8-hour full-platform outage
  (May 19, 2026) and a **cross-tenant data exposure** from a CDN
  misconfiguration (March 30, 2026). The latter is a significant red flag for a
  multi-tenant product selling data isolation.

### Why each non-selected option was set aside

- **AWS** — Most powerful and most future-proof, with best-in-class PITR
  (restore to any second within 35 days) and compliance. But for a 16-person
  firm where the owner is the ops team, it is a part-time job: ~40–80 hours of
  setup and ~5–10 hours/week ongoing, versus ~1–2 hours/week on a PaaS. Right
  answer **only** with a committed DevOps hire. Held as the deliberate
  *scale-up target*, not the launch platform.
- **Railway** — Cheapest and pleasant, now with good PITR. **Ruled out for a
  commercial multi-tenant launch** primarily because of the March 2026
  cross-tenant data-exposure incident plus an 8-hour full outage in the same
  window. Hard to defend when selling data isolation to other businesses.
- **Fly.io** — Strong edge network, honest public incident log, good storage
  (Tigris). But **no PITR on its managed Postgres yet** is a real gap for a
  business-critical app, and it carries more Postgres ops than the managed
  alternatives.
- **Supabase Edge Functions as sole compute** — Would drop the second vendor,
  but Edge Functions are Deno/TypeScript and would require **rewriting the
  existing Express app**. Not worth the cost/risk.

---

## Decision

**Launch DROVE's commercial SaaS on Render + Supabase, with AWS documented as
the explicit future scale-up target.**

1. **Compute — stay on Render.** Keep the existing Node.js/Express app on
   Render (lowest switching cost, low ops, already integrated with GitHub
   auto-deploy). **All business logic stays in Express.**
2. **Data / auth / storage / mobile — Supabase.** As part of the Issue #7
   Postgres migration, make Supabase the managed layer for:
   - **PostgreSQL** (managed, US region) — replaces SQLite-on-disk.
   - **Row-Level Security (RLS)** for clean per-tenant data isolation.
   - **Storage** (S3-compatible + CDN) for contractor job-site photos —
     replaces on-disk file storage.
   - **Auth** + **native iOS/Android/React Native SDKs** for the future mobile
     clients.
   - Add the **PITR add-on (~$100/mo)** once there are paying customers.
3. **Region** — Co-locate Render and Supabase in the **same US region**
   (e.g. both in a US-East region) to minimize the app↔DB network hop.
4. **AWS = scale-up target.** Because the app stays on standard PostgreSQL and
   S3-compatible storage, a later migration to **ECS Express Mode + RDS/Aurora
   + S3** is a re-platform, not a rewrite. Revisit when scale, enterprise SLA
   demands, or a DevOps hire justify it.

### Architecture boundary (explicit)

- **Express on Render** owns **all business logic, API endpoints, and
  integrations** (including Stripe billing). The codebase stays coherent and
  GitHub-centric.
- **Supabase** is used **purely as managed infrastructure**: Postgres, Auth,
  Storage, and mobile SDKs. We do **not** push business logic into Supabase
  Edge Functions or rely on RLS-enforced direct client-to-DB queries for app
  logic at this time. (This boundary can be revisited in a future ADR if
  warranted.)

---

## GitHub stays the source of truth (unchanged)

This decision is about **where the app runs and where data lives** — not how we
build, version, review, or roll back. **GitHub is unaffected and remains the
source of truth.**

| Concern | Today | After this decision |
| --- | --- | --- |
| GitHub repo (source of truth) | Yes | **Unchanged** |
| Branch → PR → CI gate → merge | Yes | **Unchanged** (Issue #5 CI gate still enforced) |
| Safety docs (ROLLBACK / CHANGELOG / DEPLOYMENT-LOG / RECOVERY-INDEX) | Yes | **Unchanged** |
| Git rollback tags (`known-good-*`) | Yes | **Unchanged** (Issue #6) |
| App hosting | Render | **Render (still)** |
| Database | SQLite on Render disk | **Supabase Postgres** (Issue #7) |
| Auth / tenant isolation / file storage | In-app / Render disk | **Supabase** |
| Mobile data layer | n/a | **Supabase SDKs** |

- **Render** continues to auto-deploy the Express app from the GitHub repo on
  push to `master` — the same trigger as today.
- **Database schema and migrations** (Drizzle migration files) live in the same
  GitHub repo and ship through the same PR/CI process — so schema changes become
  *more* rigorously version-controlled than the current binary SQLite file.

---

## Consequences

### Positive

- Solves the three hardest commercial requirements as **managed building
  blocks**: tenant isolation (RLS), durable Postgres + PITR + off-disk storage,
  and native mobile SDKs — rather than building each from scratch.
- Keeps **operational burden low** (~1–2 hrs/week), letting the team focus on
  selling and building rather than infrastructure.
- **Reversible:** standard Postgres + S3-compatible storage keeps the AWS
  scale-up path cheap to take later. No hard lock-in.
- **Predictable pricing** with spend caps; modest launch cost (~$40–80/mo,
  scaling to ~$180–200/mo with PITR + larger compute).
- Removes the current single-disk SQLite durability risk documented in
  `ROLLBACK.md` §6.

### Negative / risks (accepted)

- **Two-vendor architecture** (Render + Supabase): two dashboards, two bills,
  two status pages, and two points of failure instead of one. Mitigate by
  co-locating in the same US region and monitoring both. Judged worth it for
  the managed capabilities gained.
- **No contractual uptime SLA** on either Render or Supabase below their
  Enterprise tiers. Acceptable at launch scale; revisit if enterprise customers
  require SLAs (an AWS trigger).
- **Network hop** between Render (app) and Supabase (DB) — minimized by
  same-region placement; monitor query latency.
- Pricing and feature tiers shift; **re-verify exact Render/Supabase pricing and
  PITR terms immediately before committing spend.**

### Follow-up work

- **Issue #7** — Execute the SQLite → Supabase PostgreSQL migration (Drizzle
  schema, data migration, RLS policies, connection pooling).
- Move contractor photo storage off the Render disk to Supabase Storage.
- Stand up Supabase Auth + tenant model; wire Stripe subscription billing.
- Add the Supabase PITR add-on once there are paying customers.
- Re-verify current pricing/tiers before purchase.

---

## Sources

Vendor documentation and pricing reviewed June 2026:

- Render: [PostgreSQL HA](https://docs.render.com/postgresql-high-availability),
  [PostgreSQL backups/PITR](https://docs.render.com/postgresql-backups),
  [Web Services](https://docs.render.com/web-services),
  [Scaling](https://docs.render.com/scaling),
  [Regions](https://docs.render.com/regions)
- Railway: [PostgreSQL](https://docs.railway.com/databases/postgresql),
  [PITR](https://docs.railway.com/volumes/point-in-time-recovery),
  [Storage Buckets](https://docs.railway.com/storage-buckets),
  [Compliance](https://docs.railway.com/enterprise/compliance),
  [Incident report (May 19, 2026)](https://blog.railway.com/p/incident-report-may-19-2026-gcp-account-outage)
- Fly.io: [Managed Postgres options](https://community.fly.io/t/what-choices-do-fly-customers-have-for-managed-postgres/7640),
  [Pricing](https://fly.io/docs/about/pricing/),
  [Compliance](https://fly.io/compliance),
  [Infra log](https://fly.io/infra-log/)
- AWS: [App Runner](https://aws.amazon.com/apprunner/),
  [Fargate pricing](https://aws.amazon.com/fargate/pricing/),
  [RDS recovery](https://aws.amazon.com/blogs/database/amazon-rds-under-the-hood-single-az-instance-recovery/),
  [HIPAA compliance](https://aws.amazon.com/compliance/hipaa-compliance/),
  [Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- Supabase: [Backups/PITR](https://supabase.com/docs/guides/platform/backups),
  [Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
  [Auth](https://supabase.com/docs/guides/auth),
  [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres),
  [Client libraries v2](https://supabase.com/blog/client-libraries-v2)
