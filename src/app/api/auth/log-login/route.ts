import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/service-role';
import { createClient as createTokenClient } from '@supabase/supabase-js';
import { requestIp, sendLoginSharingAlerts, sessionIdFromToken } from '@/utils/security/loginAlerts';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/auth/log-login - Called right after a sign-in, by the website (cookie) and the
// app (Authorization: Bearer <access token>). Logs the login, fills in the real IP for the
// login-sharing check when the database only saw Vercel's, and emails SLAB about a new flag
// (sql/login-sharing-protection.sql does the detecting).
export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
    const supabase = bearer
      ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          global: { headers: { Authorization: `Bearer ${bearer}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : await createClient();

    const { data: { user }, error: userError } = bearer
      ? await supabase.auth.getUser(bearer)
      : await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ipAddress = requestIp(request.headers) || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const { error: logError } = await supabase.from('login_logs').insert({
      user_id: user.id,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
    if (logError) {
      console.error('Error logging login:', logError);
    }

    // Login-sharing: best-effort, never fails the sign-in
    try {
      const token = bearer ?? (await supabase.auth.getSession()).data.session?.access_token;
      const sessionId = sessionIdFromToken(token);
      const service = createServiceRoleClient();
      if (sessionId && ipAddress !== 'unknown') {
        await service.rpc('set_login_event_ip', { p_session_id: sessionId, p_ip: ipAddress });
      }
      await sendLoginSharingAlerts(service, [user.id]);
    } catch (err) {
      console.error('Login-sharing check after login failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Login logging error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
