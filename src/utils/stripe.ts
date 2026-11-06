import Stripe from 'stripe'

let client: Stripe | null = null

/** Server-only Stripe client. API version left to the SDK default. */
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('Missing STRIPE_SECRET_KEY')
    client = new Stripe(key)
  }
  return client
}
