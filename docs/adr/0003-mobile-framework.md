# ADR 0003 — Mobile Framework: React Native + Expo (Technician App)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decision owner:** Kevin Withers (Fitzpatrick Sales / Fitzpatrick Warranty Service, LLC)
- **Tracked by:** Issues #30–#35 (Phase 5 — mobile apps), Issue #17 (Phase 4 — mobile technician workflow)
- **Related:** ADR-0002 (payments — Stripe Connect + Tap to Pay ambition), Issue #24 (invoice payments)
- **Supersedes:** the Capacitor assumption baked into the original Phase 5 issue set (#30–#35). Where ADR-0002 mentions "Capacitor iOS/Android," read "Expo React Native iOS/Android."

> ADRs are short, durable records of significant architecture decisions. They
> capture the context, the decision, and the consequences so future readers
> (human or agent) understand *why* the system is the way it is. Supersede an
> ADR with a new one rather than rewriting history.

---

## Context

The Phase 5 plan assumed wrapping the existing React web app in **Capacitor**
(WebView shell). A source-cited comparison (2026-07-17) of Capacitor, React
Native + Expo, Flutter, PWA-only, native Swift/Kotlin, and Tauri v2 against
DROVE's requirements found:

- **Tap to Pay is strategic, not optional.** In-field payment collection on
  the technician's own phone is a potential game-changer for small service
  companies and a core differentiator for DROVE. Only **React Native** (and
  fully native iOS/Android) has an **official, first-party Stripe Terminal
  SDK with documented Tap to Pay** support. Capacitor has only a
  community plugin in release-candidate status; Flutter only a community
  package without offline support.
- **The market leaders validate the choice.** Jobber and ServiceTitan both
  ship React Native technician apps — and Jobber specifically migrated *off*
  a wrapped-WebView app onto React Native as the product matured.
- **Polish ceiling.** WebView apps carry a scrolling/animation ceiling on
  mid-range Android hardware — the devices real service techs carry.
- **Owner's product bar (stated 2026-07-17):** DROVE must be "a first class
  program for service companies right out of the box … If we're only going to
  go 1/2 way with this, then we're not being strong like a bison." A known
  weak spot on the flagship differentiator is unacceptable at launch.

## Decision

1. **The mobile app is built with React Native + Expo** (EAS builds/OTA,
   Expo Router, New Architecture). Capacitor is dropped from the plan.
2. **Scope: a purpose-built Technician App, not a port of the web app.**
   Field techs get a focused, mobile-first feature set (~8–12 screens):
   today's assigned jobs, service-call detail, photo capture, parts/products,
   invoice creation, payment collection (Tap to Pay + payment links), offline
   queue. The **browser app remains the office/admin product** (dispatch
   board, reports, settings, billing). iPad gets the technician app with
   layout adaptation.
3. **Shared core package.** Extract shared TypeScript into a workspace
   package consumed by both clients (`shared/` today → e.g. `@drove/core`):
   domain types, zod schemas, API client, TanStack Query query/mutation
   functions, constants, date/money utilities. UI is per-platform;
   plumbing is written once.
4. **Sync model unchanged.** DROVE stays server-authoritative — the RN app is
   simply another client of the same API and database. Offline queue +
   If-Unmodified-Since/409 conflict handling apply to the RN client the same
   way they do to the web client.
5. **Tap to Pay path:** Stripe Terminal React Native SDK on Connect (per
   ADR-0002). Apply for Apple's Tap to Pay on iPhone entitlement early
   (application + demo video; iPhone XS+; lead time required).

## Consequences

- Positive:
  - First-party Stripe rail under the flagship payments feature; no
    community-plugin dependency in the money path.
  - True native rendering — technician app can meet a "first-class,
    polished" bar on mid-range Android and iPhone alike.
  - Same architecture as Jobber/ServiceTitan — defensible in sales and
    hiring conversations.
  - The shared-core extraction improves the web codebase independently
    (types/validation/API discipline — aligns with the 2026-07-17 code
    review's H1/typing findings).
- Negative / accepted costs:
  - The technician UI is **new build**, not reuse (~20–50% overall code
    reuse via the shared core vs ~100% UI reuse with Capacitor). Accepted:
    the mobile UX *should* differ from the desktop UI.
  - Two UI codebases (web React DOM + RN) maintained by a solo operator
    with AI agents. Mitigated by the shared core and by keeping the
    technician app's scope deliberately narrow.
  - Stripe's RN Terminal SDK is officially supported but still
    beta-versioned; track releases before the Phase 6 payments build.
  - Expo/EAS adds a build-service dependency (acceptable; standard for
    solo RN operators).
- Issue updates: #30 re-scoped from "Capacitor foundation" to "Expo React
  Native foundation"; #31–#35 (store releases, permissions, account
  deletion, TestFlight/Play testing) remain valid with RN/EAS tooling;
  #17's mobile workflow lands inside the technician app.

## Re-evaluation triggers

- Stripe ships breaking changes or abandons the RN Terminal SDK (unlikely;
  it is the documented Tap to Pay path).
- The technician-app build proves unsustainable solo → consider narrowing
  scope further before considering a WebView fallback.

## References

- Research report: "DROVE Mobile Framework Comparison (2026-07-17)" —
  source-cited comparison (workspace artifact shared 2026-07-17; key sources:
  docs.stripe.com Terminal Tap to Pay pages, stripe-terminal-react-native
  GitHub releases, reactnative.dev New Architecture posts, expo.dev Router
  v5 + EAS docs, bool.ca Jobber RN migration write-up, ServiceTitan RN
  engineering job postings, capacitorjs.com camera docs,
  npmjs.com @capacitor-community/stripe-terminal, Apple App Review
  Guidelines 4.2).
- ADR-0002 — payments provider (Stripe Billing + Connect Standard).
