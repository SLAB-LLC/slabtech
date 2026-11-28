import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Sign-in links for reps who were given an account but never signed in
 * (sql/engagement-nudges-migration.sql). The link lets them pick their own password.
 *
 * The token is the user id + the time the email went out (user_profiles.sign_in_nudged_at),
 * signed with a server secret. Setting a password clears sign_in_nudged_at, so a link works
 * once, and only the newest email's link works. Links expire after 21 days.
 */
const MAX_AGE_MS = 21 * 86400000

function secret(): string {
  const s = process.env.SIGN_IN_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('No secret for sign-in links')
  return s
}

const sign = (payload: string) => createHmac('sha256', secret()).update(`sign-in-link:${payload}`).digest('base64url')

export function makeSignInToken(userId: string, nudgedAt: string): string {
  const payload = Buffer.from(`${userId}.${new Date(nudgedAt).getTime()}`).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Returns the user id and the nudge time (ms) the token was made for, or null. */
export function readSignInToken(token: string): { userId: string; nudgedAtMs: number } | null {
  const [payload, sig] = String(token || '').split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const [userId, ms] = Buffer.from(payload, 'base64url').toString().split('.')
  const nudgedAtMs = Number(ms)
  if (!userId || !Number.isFinite(nudgedAtMs) || Date.now() - nudgedAtMs > MAX_AGE_MS) return null
  return { userId, nudgedAtMs }
}

/** True if the token matches the user's current sign_in_nudged_at. */
export function tokenMatches(nudgedAtMs: number, current: string | null): boolean {
  return !!current && new Date(current).getTime() === nudgedAtMs
}
