# Stripe integration: what's left

Hosted Stripe Checkout is wired up for **company subscriptions**. When an owner (or a SLAB admin) starts checkout, they go to a Stripe-hosted page and enter a bank account (ACH) or card. Stripe starts the monthly subscription, and our webhook saves the Stripe IDs on the company.

## Values to Replace

The following values are placeholders and must be updated before going live.

**Files containing placeholders:**
- [src/app/api/billing/checkout/route.ts](src/app/api/billing/checkout/route.ts) (reads them from env vars)
- [.env.example](.env.example)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | subscription | Already correct for monthly billing. |
| success_url | `{site}/c/{company slug}/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}` | Real value. Change only if you want a dedicated "thanks" page. |
| cancel_url | `{site}/c/{company slug}/dashboard?billing=cancelled` | Real value. |
| line_items[0].price | `STRIPE_PRICE_PLATFORM` env var, falls back to `price_...` | The Price ID of the **$300/month platform fee** (recurring, monthly, flat). |
| line_items[1].price | `STRIPE_PRICE_AUDIO_DAY` env var (left out if unset) | The Price ID of the **$8 per rep audio day** price (recurring, monthly, *usage-based* / metered, tied to a meter). |

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [src/app/api/billing/checkout/route.ts](src/app/api/billing/checkout/route.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | hosted_page (stripe SDK v23) |
| billing_address_collection | auto |
| phone_number_collection | { enabled: false } |
| automatic_tax | { enabled: false } |
| allow_promotion_codes | false |
| payment_method_collection | always |
| submit_type | auto |
| integration_identifier | hosted_web_0001 |
| origin_context | web |

## Setup

1. **Run the SQL.** Run [sql/stripe-billing-migration.sql](sql/stripe-billing-migration.sql) in the Supabase SQL Editor. It adds `stripe_customer_id` and `stripe_subscription_id` to `companies`.
2. **Create the products in Stripe** (Dashboard > Product catalog):
   - "SLAB Platform": $300.00 USD, recurring monthly.
   - "Rep audio day": $8.00 USD per unit, recurring monthly, usage-based. Create a meter named `rep_audio_days` (sum) when Stripe asks.
3. **Add env vars in Vercel** (Project > Settings > Environment Variables), then redeploy:
   - `STRIPE_SECRET_KEY` (Developers > API keys; use the `sk_test_` key first, then the `sk_live_` key)
   - `STRIPE_WEBHOOK_SECRET` (from step 4)
   - `STRIPE_PRICE_PLATFORM`, `STRIPE_PRICE_AUDIO_DAY` (the `price_...` IDs from step 2)
   - `STRIPE_PUBLISHABLE_KEY` isn't used yet (hosted checkout needs no browser key) but is listed for later.
4. **Add the webhook** (Developers > Webhooks > Add endpoint):
   - URL: `https://slabtraining.com/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
   - Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Turn on payment methods** (Settings > Payment methods): Cards and ACH Direct Debit.

## New files

```
src/utils/stripe.ts                       Stripe client (server only)
src/app/api/billing/checkout/route.ts     POST: start hosted checkout for a company
src/app/api/billing/webhook/route.ts      POST: Stripe events -> companies table
sql/stripe-billing-migration.sql          companies.stripe_customer_id / stripe_subscription_id
```

## How it works

1. A company owner (or SLAB admin) submits `<form method="POST" action="/api/billing/checkout">` (SLAB admins add a hidden `company_id` field). The route checks they can manage that company.
2. The route creates a Checkout Session in subscription mode with the platform price (and the audio-day price if set), tagged with the company ID, and redirects to Stripe's page.
3. The customer pays. Stripe sends `checkout.session.completed`, and the webhook saves the customer and subscription IDs on the company and sets `billing_status = 'active'`.
4. If the subscription is ever cancelled, the webhook sets `billing_status = 'cancelled'`.

## Testing

Use test mode keys (`sk_test_...`). Test card `4242 4242 4242 4242`, any future date, any CVC. For ACH in test mode, choose the test bank on the checkout page. To send webhooks to your laptop: `stripe listen --forward-to localhost:3000/api/billing/webhook`.

## Next steps (not built yet)

- **A "Set up billing" button** on the company dashboard (and in the SLAB admin Companies page) that posts to `/api/billing/checkout`.
- **Report audio days to Stripe**: a daily Vercel cron that counts each company's new rep audio days from `vault_days` and sends them to the `rep_audio_days` meter, so they show up on the next invoice.
- **Billing portal link** so owners can see invoices and change their bank account.
- **Ace's start date**: Ace is free until Jan 1, 2027. Either create Ace's subscription by hand in the Stripe Dashboard with a Jan 1 start, or add `subscription_data.trial_end` for them.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
