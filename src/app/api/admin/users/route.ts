import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/service-role';
import { NextRequest, NextResponse } from 'next/server';
import { accountErrorResponse, createAccount, getManagingActor } from '@/utils/users/accounts';

// GET all users (admin only)
export async function GET() {
  try {
    const supabase = await createClient();

    // Verify admin using regular client (can read own profile)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id')
      .eq('id', user.id)
      .single();

    if (!profile || !['super_admin', 'company_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use service role client to fetch users
    const serviceSupabase = createServiceRoleClient();

    // Super admins can see all users, company admins see only their company's users
    let query = serviceSupabase.from('user_profiles').select('*');

    if (profile.role === 'company_admin') {
      query = query.eq('company_id', profile.company_id);
    }

    const { data: users, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST create new user: same rules as an owner's company portal (src/utils/users/accounts.ts)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const actor = await getManagingActor(supabase);
    const user = await createAccount(actor, await request.json());
    return NextResponse.json({ success: true, user });
  } catch (error) {
    const { body, status } = accountErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
