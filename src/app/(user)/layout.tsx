import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { ActivityTrackingProvider } from '@/components/ActivityTrackingProvider';

export default async function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/user/login');
  }

  // Check if user has a profile and their role
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  // If user is inactive, sign them out and redirect
  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect('/user/login?error=account_disabled');
  }

  // If user is admin, redirect them to admin area
  if (profile?.role === 'admin') {
    redirect('/admin');
  }

  return <ActivityTrackingProvider>{children}</ActivityTrackingProvider>;
}
