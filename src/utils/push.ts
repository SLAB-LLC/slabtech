import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Push notifications through Expo to the app, skipping people who turned the category off.
 * Needs the service-role client (push tokens and preferences are private).
 */
export async function sendPush(
  service: SupabaseClient,
  opts: { userIds: string[]; title: string; body: string; category: string; data?: Record<string, unknown> }
): Promise<{ sent: number; tokens: number }> {
  if (opts.userIds.length === 0) return { sent: 0, tokens: 0 }

  const { data: tokenRows, error } = await service
    .from('user_push_tokens')
    .select('token, user_id')
    .eq('is_active', true)
    .in('user_id', opts.userIds)
  if (error) throw error
  if (!tokenRows?.length) return { sent: 0, tokens: 0 }

  const { data: prefs } = await service
    .from('notification_preferences')
    .select(`user_id, ${opts.category}`)
    .in('user_id', tokenRows.map((t) => t.user_id))
  const optedOut = new Set((prefs ?? []).filter((p: any) => p[opts.category] === false).map((p: any) => p.user_id))

  const tokens = tokenRows
    .filter((t) => !optedOut.has(t.user_id))
    .map((t) => t.token as string)
    .filter((t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['))

  let sent = 0
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100)
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map((to) => ({ to, sound: 'default', title: opts.title, body: opts.body, data: { type: opts.category, ...opts.data } }))),
    })
    if (res.ok) sent += batch.length
  }
  return { sent, tokens: tokens.length }
}
