# Stripe Connect Invoice Payments

This app can collect invoice payments through Stripe Checkout while keeping DROVE platform billing separate from tenant invoice revenue.

## Environment

Set these on the Express app host:

- `STRIPE_SECRET_KEY`: Stripe secret key for the platform or tenant Stripe account.
- `STRIPE_WEBHOOK_SECRET`: Signing secret for the `POST /api/stripe/webhook` endpoint.
- `APP_BASE_URL`: Public app URL, for example `https://fitzpatrick-service-tracker.onrender.com`.

Optional:

- `STRIPE_CONNECT_ACCOUNT_ID`: Existing connected account id. If omitted, managers can create an Express onboarding link through the API and the app stores the account id in SQLite.
- `STRIPE_PLATFORM_FEE_BPS`: Platform fee in basis points for Connect destination charges. Leave unset for no application fee.
- `STRIPE_INVOICE_CURRENCY`: Checkout currency. Defaults to `usd`.

## Manager API

- `GET /api/stripe/connect/status`: shows whether Stripe is configured and whether a connected account can charge and receive payouts.
- `POST /api/stripe/connect/account-link`: creates or reuses an Express connected account and returns a Stripe-hosted onboarding URL.
- `DELETE /api/stripe/connect/account`: clears the locally stored connected account. This is blocked when `STRIPE_CONNECT_ACCOUNT_ID` is configured by environment.

All manager API calls require the normal app Bearer token.

## Invoice Flow

1. Open any unpaid invoice with a positive total.
2. Click **Collect Payment**.
3. The server creates a Stripe Checkout Session.
4. Stripe redirects the payer to Checkout.
5. Stripe calls `POST /api/stripe/webhook`.
6. `checkout.session.completed` or `payment_intent.succeeded` marks the invoice `Paid`, sets `paid_date`, and records Stripe ids on the invoice.

## Local Webhook Test

Use Stripe CLI in test mode:

```sh
stripe listen --forward-to localhost:5000/api/stripe/webhook
stripe trigger checkout.session.completed
```

For app-specific tests, create a real unpaid invoice in the app, start Checkout from **Collect Payment**, pay with a Stripe test card, and confirm the invoice changes to `Paid` after the webhook.
