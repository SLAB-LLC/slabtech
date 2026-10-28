'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { Heading, Text, Card, Container } from '@/components';
import { CreateAccountModal, RoleLevelPicker } from '@/components/users/AccountControls';

interface ProfileFields {
  id: string;
  role: string;
  level: string | null;
  company_id: string | null;
}

interface UserLoginStats {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  logins_last_7_days: number;
  logins_last_24_hours: number;
  unique_days_logged_in: number;
  last_login: string | null;
  is_suspicious: boolean;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserLoginStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [orphanedUsers, setOrphanedUsers] = useState<any[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  // Role, level and company per account, the companies, and who's signed in
  const [profiles, setProfiles] = useState<Record<string, ProfileFields>>({});
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);

  const fetchUsers = async () => {
    const supabase = createClient();

    const [{ data, error }, profilesRes, companiesRes, authRes] = await Promise.all([
      // Login stats from the view
      supabase.from('user_login_stats').select('*').order('email'),
      fetch('/api/admin/users').then((r) => (r.ok ? r.json() : { users: [] })),
      supabase.from('companies').select('id, name').order('name'),
      supabase.auth.getUser(),
    ]);

    if (data && !error) {
      setUsers(data);
    }
    const byId: Record<string, ProfileFields> = {};
    for (const p of (profilesRes.users ?? []) as ProfileFields[]) byId[p.id] = p;
    setProfiles(byId);
    setCompanies(companiesRes.data ?? []);
    const myId = authRes.data.user?.id;
    if (myId) setMe({ id: myId, role: byId[myId]?.role ?? 'user' });

    setLoading(false);
  };

  const companyName = (id: string | null | undefined) => companies.find((c) => c.id === id)?.name ?? 'No company';

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      setShowDeleteModal(null);
      fetchUsers();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update user');
      }

      fetchUsers();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleCheckOrphanedUsers = async () => {
    setCleanupLoading(true);
    try {
      const response = await fetch('/api/admin/cleanup-orphaned');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check orphaned users');
      }

      setOrphanedUsers(data.orphanedUsers || []);
      setShowCleanupModal(true);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleCleanupOrphanedUsers = async () => {
    setCleanupLoading(true);
    try {
      const response = await fetch('/api/admin/cleanup-orphaned', {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cleanup orphaned users');
      }

      alert(data.message);
      setShowCleanupModal(false);
      setOrphanedUsers([]);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setCleanupLoading(false);
    }
  };

  return (
    <Container maxWidth="xl" padding="lg">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/admin" className="text-steel-gray hover:text-midnight-blue">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Heading level={1} size="xl" className="text-gray-900">
            User Management
          </Heading>
        </div>
        <Text variant="muted" className="mb-4 text-gray-600">
          Create, manage, and monitor user accounts
        </Text>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleCheckOrphanedUsers}
            disabled={cleanupLoading}
            className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm sm:text-base"
          >
            {cleanupLoading ? 'Checking...' : 'Cleanup Orphaned'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-success-gold text-white font-semibold rounded-lg hover:bg-amber-500 transition-colors text-sm sm:text-base"
          >
            + Create User
          </button>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-success-gold"></div>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Text variant="muted" className="text-gray-600">No users found. Create your first user to get started.</Text>
        </div>
      ) : (
        <>
          {/* Horizontal Scroll Indicator */}
          <div className="mb-4 flex items-center justify-center gap-2 text-xs text-steel-gray lg:hidden">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
            </svg>
            <span>Swipe to see more</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>

          {/* Mobile Card Layout */}
          <div className="lg:hidden space-y-4">
            {users.map((user) => (
              <div key={user.user_id} className={`bg-white rounded-lg shadow-sm border p-4 ${user.is_suspicious ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                <div className="space-y-3">
                  {/* User Info */}
                  <div>
                    <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {user.display_name || user.email}
                      {user.is_suspicious && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                          Suspicious
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">{user.email}</div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2">
                    {me && (
                      <RoleLevelPicker
                        actorRole={me.role}
                        userId={user.user_id}
                        role={profiles[user.user_id]?.role ?? user.role}
                        level={profiles[user.user_id]?.level ?? null}
                        isSelf={user.user_id === me.id}
                        onChanged={fetchUsers}
                      />
                    )}
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                      {companyName(profiles[user.user_id]?.company_id)}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      user.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {user.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-600 text-xs">Logins (7 days)</div>
                      <div className="font-medium text-gray-900">{user.logins_last_7_days}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 text-xs">Last Login</div>
                      <div className="font-medium text-gray-900">
                        {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-gray-200">
                    <Link
                      href={`/users/${user.user_id}`}
                      className="flex-1 text-center px-3 py-2 bg-success-gold text-black text-sm font-medium rounded-lg hover:bg-amber-500"
                    >
                      Manage
                    </Link>
                    <button
                      onClick={() => handleToggleActive(user.user_id, user.is_active)}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border ${
                        user.is_active
                          ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'border-green-300 text-green-700 hover:bg-green-50'
                      }`}
                    >
                      {user.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => setShowDeleteModal(user.user_id)}
                      className="px-3 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table Layout */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role · Company
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Logins (7 days)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Login
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.user_id} className={`hover:bg-gray-50 ${user.is_suspicious ? 'bg-red-50' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                        {user.display_name || user.email}
                        {user.is_suspicious && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                            Suspicious
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {me && (
                      <RoleLevelPicker
                        actorRole={me.role}
                        userId={user.user_id}
                        role={profiles[user.user_id]?.role ?? user.role}
                        level={profiles[user.user_id]?.level ?? null}
                        isSelf={user.user_id === me.id}
                        onChanged={fetchUsers}
                      />
                    )}
                    <div className="text-xs text-gray-500 mt-1">{companyName(profiles[user.user_id]?.company_id)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      user.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {user.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {user.logins_last_7_days} logins
                    </div>
                    <div className="text-xs text-gray-500">
                      {user.unique_days_logged_in} unique days
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.last_login
                      ? new Date(user.last_login).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/users/${user.user_id}`}
                        className="text-success-gold hover:text-amber-600"
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => handleToggleActive(user.user_id, user.is_active)}
                        className={`${
                          user.is_active
                            ? 'text-gray-500 hover:text-gray-700'
                            : 'text-green-600 hover:text-green-700'
                        }`}
                      >
                        {user.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => setShowDeleteModal(user.user_id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Create User Modal: the same form owners use in their company portal */}
      {showCreateModal && me && (
        <CreateAccountModal
          actorRole={me.role}
          companies={companies}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchUsers();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-red-600 mb-4">Delete User</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this user? This action cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteUser(showDeleteModal)}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup Orphaned Users Modal */}
      {showCleanupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-midnight-blue mb-4">Orphaned Users Cleanup</h2>

            {orphanedUsers.length === 0 ? (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
                No orphaned users found. All auth users have corresponding profiles.
              </div>
            ) : (
              <>
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-4">
                  Found {orphanedUsers.length} orphaned user(s) - users in auth without profiles.
                </div>

                <div className="max-h-64 overflow-y-auto mb-4">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Confirmed</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {orphanedUsers.map((user) => (
                        <tr key={user.id}>
                          <td className="px-4 py-2 text-sm text-gray-900">{user.email}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {new Date(user.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {user.email_confirmed_at ? (
                              <span className="text-green-600">Yes</span>
                            ) : (
                              <span className="text-gray-400">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCleanupModal(false);
                  setOrphanedUsers([]);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              {orphanedUsers.length > 0 && (
                <button
                  onClick={handleCleanupOrphanedUsers}
                  disabled={cleanupLoading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {cleanupLoading ? 'Cleaning...' : `Delete ${orphanedUsers.length} User(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}
