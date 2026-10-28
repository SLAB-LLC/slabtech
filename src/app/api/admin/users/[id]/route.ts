import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/service-role';
import { NextRequest, NextResponse } from 'next/server';
import { accountErrorResponse, getManagingActor, updateAccount } from '@/utils/users/accounts';

// Helper to verify admin access
async function verifyAdmin(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Unauthorized', status: 401 };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!['super_admin', 'company_admin'].includes(profile?.role || '')) {
    return { error: 'Forbidden', status: 403 };
  }

  return { user, profile };
}

// GET single user details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const adminCheck = await verifyAdmin(supabase);
    if ('error' in adminCheck) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    // Use service role client to fetch user data (bypasses RLS)
    const serviceSupabase = createServiceRoleClient();

    // Get user profile with company info
    const { data: profile, error: profileError } = await serviceSupabase
      .from('user_profiles')
      .select('*, companies(id, name, slug)')
      .eq('id', id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get login history
    const { data: loginHistory } = await serviceSupabase
      .from('login_logs')
      .select('*')
      .eq('user_id', id)
      .order('logged_in_at', { ascending: false })
      .limit(50);

    // Get assigned transcripts
    const { data: assignments } = await serviceSupabase
      .from('transcript_assignments')
      .select(`
        id,
        assigned_at,
        transcripts (
          id,
          original_filename,
          salesperson_name,
          created_at
        )
      `)
      .eq('user_id', id);

    return NextResponse.json({
      profile,
      loginHistory: loginHistory || [],
      assignments: assignments || [],
    });
  } catch (error: any) {
    console.error('Error fetching user:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH update user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const adminCheck = await verifyAdmin(supabase);
    if ('error' in adminCheck) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    const actor = await getManagingActor(supabase);
    await updateAccount(actor, id, await request.json());
    const { data } = await createServiceRoleClient().from('user_profiles').select('*').eq('id', id).single();
    return NextResponse.json({ success: true, profile: data });
  } catch (error) {
    const { body, status } = accountErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// DELETE user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const adminCheck = await verifyAdmin(supabase);
    if ('error' in adminCheck) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    // Prevent self-deletion
    if (adminCheck.user.id === id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Use service role client to delete (bypasses RLS)
    const serviceSupabase = createServiceRoleClient();

    // Delete from auth first (this is the critical step)
    try {
      const { error: authError } = await serviceSupabase.auth.admin.deleteUser(id);
      if (authError) {
        console.error('Auth deletion error:', authError);
        throw new Error(`Failed to delete user from auth: ${authError.message}`);
      }
    } catch (authError: any) {
      console.error('Could not delete user from auth:', authError);
      throw new Error(`Failed to delete user from authentication system: ${authError.message || 'Unknown error'}`);
    }

    // Delete user profile (cascade will handle assignments and logs)
    const { error: profileError } = await serviceSupabase
      .from('user_profiles')
      .delete()
      .eq('id', id);

    if (profileError) {
      console.error('Profile deletion error:', profileError);
      throw profileError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
