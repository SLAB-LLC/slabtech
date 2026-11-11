import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/service-role';
import { NextRequest, NextResponse } from 'next/server';

// Golden Door awards (sql/golden-door-migration.sql). Admins can see a rep's count;
// only SLAB super admins can change it.

async function viewerRole(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null };
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single();
  return { user, role: (profile?.role as string | undefined) ?? null };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, role } = await viewerRole(await createClient());
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['super_admin', 'company_admin'].includes(role || '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await createServiceRoleClient().from('rep_awards').select('golden_doors').eq('user_id', id).maybeSingle();
  if (error) {
    // Table not migrated yet: say so instead of showing 0
    return NextResponse.json({ goldenDoors: 0, canEdit: role === 'super_admin', ready: false });
  }
  return NextResponse.json({ goldenDoors: data?.golden_doors ?? 0, canEdit: role === 'super_admin', ready: true });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, role } = await viewerRole(await createClient());
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'super_admin') return NextResponse.json({ error: 'Only SLAB admins can give Golden Doors' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const n = Number(body?.goldenDoors);
  if (!Number.isInteger(n) || n < 0 || n > 20) {
    return NextResponse.json({ error: 'Golden Doors must be a whole number from 0 to 20' }, { status: 400 });
  }

  const { error } = await createServiceRoleClient()
    .from('rep_awards')
    .upsert({ user_id: id, golden_doors: n, updated_at: new Date().toISOString(), updated_by: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goldenDoors: n });
}
