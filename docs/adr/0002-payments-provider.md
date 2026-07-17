# ADR 0002 — Payments & Billing Provider for DROVE

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decision owner:** Kevin Withers (Fitzpatrick Sales / Fitzpatrick Warranty Service, LLC)
- **Tracked by:** Issue #11 (Phase 2 — subscription billing), Issue #24 (Phase 6 — invoice payments)
- **Related:** Issue #28 (pricing/packaging), Issue #29 (app-store billing policy), ADR-0001 (hosting)

> ADRs are short, durable records of significant architecture decisions. They
> capture the context, the decision, and the consequences so future readers
> (human or agent) understand *why* the system is the way it is. Supersede an
> ADR with a new one rather than rewriting history.

---

## Context

DROVE has two distinct payment needs that are easy to conflate:

- **(A) Subscription billing** — charging tenant companies for DROVE itself
  (Starter/Professional/Business plans, 14-day trial, customer portal, dunning).
- **(B) Embedded invoice payments with a platform take-rate** — letting each
  tenant collect card/ACH payments from *their* customers on DROVE invoices,
  with DROVE keeping a small percentage of each transaction. This is a
  deliberate second revenue stream alongside subscriptions.

Constraints: DROVE starts at ~$0 payment volume; realistic year-1–2 volume is
well under $5M/yr. Tenants are small service contractors (≤ ~25 employees).
Field technicians will eventually want in-person Tap to Pay. Mobile apps
(Capacitor iOS/Android) must comply with Apple/Google store rules.

A source-cited comparison (2026-07-17) evaluated Stripe, Adyen for Platforms,
Square, Braintree Marketplace, Rainforest, Tilled, Finix, Payrix/Worldpay,
Paddle, and Lemon Squeezy across pricing, take-rate mechanics, volume minimums,
sub-merchant onboarding/risk, ACH, Tap to Pay, and payout timing.

Key findings:

- Every credible payfac-style alternative has a floor DROVE does not yet clear:
  Finix targets platforms ≥ $5M/yr; Adyen has a monthly minimum invoice and a
  practical ~$1M+/yr floor; Payrix/Worldpay targets $10M–$50M/yr; Tilled
  charges $500/mo fixed before any volume.
- Stripe Connect has **no volume minimum**, **no per-account cost on Standard
  accounts**, Stripe-underwritten near-instant tenant onboarding, application
  fees for the take-rate, ACH at 0.8% capped at $5, and Tap to Pay on
  iPhone/Android for connected accounts.
- The direct competitors validate the rail: **Jobber, Housecall Pro, and
  ServiceM8 all run payments on Stripe**, charging contractors ~2.6%–3.1% +
  30¢ on cards and ~1% on ACH. ServiceM8 publishes the clearest platform
  take-rate: Stripe's fee + 0.20%.
- Merchant-of-record providers (Paddle 5% + 50¢, Lemon Squeezy 5% + 50¢) fit
  only need (A), are structurally wrong for need (B) (physical-service
  invoices, ACH, in-person), and Lemon Squeezy is being absorbed into Stripe.
- Apple App Review Guideline 3.1.3(e) exempts payments for real-world services
  from in-app purchase — a plumbing invoice paid in-app owes Apple nothing.
  The SaaS subscription itself (need A) should be sold via the web, not as an
  iOS in-app purchase.

## Decision

1. **Stripe is the payments and billing provider for DROVE** — one vendor, one
   account, covering both needs:
   - **Need A: Stripe Billing** (products/prices, 14-day trial, webhooks,
     Customer Portal, Smart Retries) per Issue #11.
   - **Need B: Stripe Connect** with **application fees** as the platform
     take-rate mechanism per Issue #24.
2. **Start with Connect Standard accounts, not Express/Custom.** Standard
   costs the platform nothing per account, Stripe carries underwriting and the
   dashboard relationship, and onboarding is hosted. Graduate to Express only
   when white-label UX or embedded Tap to Pay flows justify the $2/mo active
   account + payout fees.
3. **Take-rate posture:** price tenant card processing in the market-normal
   band established by Jobber/Housecall Pro/ServiceM8 (~2.6%–3.1% + fixed on
   cards, ~1% ACH), i.e. a DROVE margin of roughly 0.2%–1% over Stripe's cost.
   Exact rates are a business decision finalized with Issue #28.
4. **Mobile compliance posture (Issue #29):** invoice payments in-app are
   exempt under Apple 3.1.3(e); DROVE subscriptions are sold on the web —
   mobile apps are login-only for billing.

## Consequences

- Positive: zero fixed payments cost at zero volume; one API surface and one
  webhook infrastructure for both revenue streams; tenant onboarding is
  Stripe-hosted KYC (DROVE never touches underwriting); Tap to Pay path exists
  for Phase 4/5 mobile field workflows; the stack matches what the market
  leaders run, so pricing is defensible in sales conversations.
- Negative / accepted risks:
  - Stripe's published risk is **account freezes/holds** on connected
    accounts. Mitigation: tenant-facing messaging and support runbook for
    holds; never front funds to tenants.
  - Stripe Billing costs 0.7% of subscription volume on top of processing —
    acceptable at launch scale; revisit if MRR grows large.
  - At sustained platform volume past ~$5M/yr, a buy-rate payfac
    (**Rainforest** is the strongest candidate: published $0–5M/mo buy-rate
    tier, no revenue split, next-day funding) would improve take-rate margins.
    Re-evaluate then; supersede this ADR if switching.
- Issue #24 acceptance criteria should be read with "approved flow" =
  **Connect Standard hosted onboarding** and "platform fee behavior" =
  **application fees on destination/direct charges**, per this ADR.

## References

- Research report: "DROVE Payments Platform Comparison (2026-07-17)" —
  source-cited comparison across all ten providers (workspace artifact shared
  2026-07-17; key sources: stripe.com/pricing, stripe.com/connect/pricing,
  support.stripe.com "monetizing payments with Stripe Connect",
  rainforestpay.com/pricing, tilled.com/pricing, finix.com/pricing/platforms,
  developer.apple.com App Review Guidelines 3.1.3(e),
  help.housecallpro.com payment processing options, ServiceM8 Stripe
  transaction fees support page).
