'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { Heading, Text, Container } from '@/components';
import { CreateAccountModal, RoleLevelPicker } from '@/components/users/AccountControls';
import { ResetPasswordModal } from '@/components/users/ResetPasswordModal';
import { ALL_ROLES, LEVELS, LEVEL_LABELS, ROLE_LABELS } from '@/utils/users/roles';

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  level: string | null;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface LoginStats {
  user_id: string;
  logins_last_7_days: number;
  unique_days_logged_in: number;
  last_login: string | null;
  is_suspicious: boolean;
}

interface Row extends Profile {
  name: string;
  companyName: string;
  logins7: number;
  uniqueDays: number;
  lastLogin: string | null;
  suspicious: boolean;
}

type SortKey = 'name' | 'last_login' | 'newest';

interface Filters {
  q: string;
  company: string; // '' = all, 'none' = no company, else company id
  role: string;
  level: string;
  status: '' | 'active' | 'disabled';
  sort: SortKey;
}

const EMPTY_FILTERS: Filters = { q: '', company: '', role: '', level: '', status: '', sort: 'name' };
const FILTERS_KEY = 'slab-admin-users-filters';

function loadFilters(): Filters {
  try {
    const saved = sessionStorage.getItem(FILTERS_KEY);
    if (saved) return { ...EMPTY_FILTERS, ...JSON.parse(saved) };
  } catch {
    // Storage blocked: start fresh
  }
  return EMPTY_FILTERS;
}

const selectClass =
  'px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm text-gray-900 focus:ring-2 focus:ring-success-gold focus:border-transparent';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'Never');

export default function UserManagementPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stats, setStats] = useState<Record<string, LoginStats>>({});
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [orphanedUsers, setOrphanedUsers] = useState<any[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const fetchUsers = async () => {
    const supabase = createClient();
    const [statsRes, profilesRes, companiesRes, authRes] = await Promise.all([
      supabase.from('user_login_stats').select('user_id, logins_last_7_days, unique_days_logged_in, last_login, is_suspicious'),
      fetch('/api/admin/users').then((r) => (r.ok ? r.json() : { users: [] })),
      supabase.from('companies').select('id, name').order('name'),
      supabase.auth.getUser(),
    ]);

    const byId: Record<string, LoginStats> = {};
    for (const s of (statsRes.data ?? []) as LoginStats[]) byId[s.user_id] = s;
    setStats(byId);

    const list = (profilesRes.users ?? []) as Profile[];
    setProfiles(list);
    setCompanies(companiesRes.data ?? []);
    const myId = authRes.data.user?.id;
    if (myId) setMe({ id: myId, role: list.find((p) => p.id === myId)?.role ?? 'user' });
    setLoading(false);
  };

  useEffect(() => {
    setFilters(loadFilters());
    setFiltersLoaded(true);
    fetchUsers();
  }, []);

  // Keep the filters when going into a user and coming back
  useEffect(() => {
    if (!filtersLoaded) return;
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Storage blocked: filters just won't stick
    }
  }, [filters, filtersLoaded]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const companyNames = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.name])), [companies]);

  const rows: Row[] = useMemo(
    () =>
      profiles.map((p) => {
        const s = stats[p.id];
        return {
          ...p,
          name: p.display_name && p.display_name !== p.email ? p.display_name : p.email,
          companyName: (p.company_id && companyNames[p.company_id]) || 'No company',
          logins7: s?.logins_last_7_days ?? 0,
          uniqueDays: s?.unique_days_logged_in ?? 0,
          lastLogin: s?.last_login ?? null,
          suspicious: !!s?.is_suspicious,
        };
      }),
    [profiles, stats, companyNames]
  );

  const companyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = r.company_id || 'none';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (q && !`${r.name} ${r.email} ${r.companyName}`.toLowerCase().includes(q)) return false;
      if (filters.company === 'none' ? r.company_id : filters.company && r.company_id !== filters.company) return false;
      if (filters.role && r.role !== filters.role) return false;
      if (filters.level && (r.level || 'rookie') !== filters.level) return false;
      if (filters.status === 'active' && !r.is_active) return false;
      if (filters.status === 'disabled' && r.is_active) return false;
      return true;
    });
    out.sort((a, b) => {
      if (filters.sort === 'last_login') return (b.lastLogin ?? '').localeCompare(a.lastLogin ?? '');
      if (filters.sort === 'newest') return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return out;
  }, [rows, filters]);

  const filtered = JSON.stringify({ ...filters, sort: 'name' }) !== JSON.stringify(EMPTY_FILTERS);

  const handleDeleteUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }
      setDeleting(null);
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
      if (!response.ok) throw new Error(data.error || 'Failed to check orphaned users');
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
      const response = await fetch('/api/admin/cleanup-orphaned', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to cleanup orphaned users');
      alert(data.message);
      setShowCleanupModal(false);
      setOrphanedUsers([]);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setCleanupLoading(false);
    }
  };

  const statusPill = (active: boolean) => (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
      {active ? 'Active' : 'Disabled'}
    </span>
  );

  const suspiciousPill = (
    <span
      title="Lots of logins in the last day: the account may be shared"
      className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full"
    >
      Suspicious
    </span>
  );

  const actionLinks = (r: Row, compact: boolean) => {
    const btn = compact
      ? 'flex-1 text-center px-3 py-2 text-sm font-medium rounded-lg border'
      : 'hover:underline';
    return (
      <>
        <Link
          href={`/users/${r.id}`}
          className={compact ? `${btn} bg-success-gold border-success-gold text-black` : 'text-amber-600 hover:text-amber-700 font-medium'}
        >
          Manage
        </Link>
        <button
          onClick={() => setResetting(r)}
          className={compact ? `${btn} border-gray-300 text-gray-700` : 'text-gray-700 hover:text-gray-900'}
        >
          Reset password
        </button>
        <button
          onClick={() => handleToggleActive(r.id, r.is_active)}
          className={compact ? `${btn} border-gray-300 text-gray-700` : r.is_active ? 'text-gray-500 hover:text-gray-700' : 'text-green-600 hover:text-green-700'}
        >
          {r.is_active ? 'Disable' : 'Enable'}
        </button>
        {r.id !== me?.id && (
          <button
            onClick={() => setDeleting(r)}
            className={compact ? 'px-3 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg' : 'text-red-500 hover:text-red-700'}
          >
            Delete
          </button>
        )}
      </>
    );
  };

  return (
    <Container maxWidth="xl" padding="lg">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <Heading level={1} size="xl" className="text-gray-900">
            Users
          </Heading>
          <Text variant="muted" className="text-gray-600">
            {loading ? 'Loading…' : `${rows.length} accounts across ${companies.length} companies`}
          </Text>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleCheckOrphanedUsers}
            disabled={cleanupLoading}
            title="Find logins that have no profile (left over from failed sign-ups)"
            className="px-4 py-2 border border-gray-300 bg-white text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
          >
            {cleanupLoading ? 'Checking...' : 'Cleanup orphaned'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-success-gold text-black font-semibold rounded-lg hover:bg-amber-500 transition-colors text-sm"
          >
            + Create user
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <div className="relative mb-3">
          <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
          </svg>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Search by name, email or company"
            autoFocus
            className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-success-gold focus:border-transparent"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select aria-label="Company" value={filters.company} onChange={(e) => setFilter('company', e.target.value)} className={selectClass}>
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({companyCounts[c.id] ?? 0})
              </option>
            ))}
            {companyCounts.none ? <option value="none">No company ({companyCounts.none})</option> : null}
          </select>
          <select aria-label="Role" value={filters.role} onChange={(e) => setFilter('role', e.target.value)} className={selectClass}>
            <option value="">All roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <select aria-label="Level" value={filters.level} onChange={(e) => setFilter('level', e.target.value)} className={selectClass}>
            <option value="">Rookies and vets</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{LEVEL_LABELS[l]}s</option>
            ))}
          </select>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value as Filters['status'])} className={selectClass}>
            <option value="">Active and disabled</option>
            <option value="active">Active only</option>
            <option value="disabled">Disabled only</option>
          </select>
          <select aria-label="Sort" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as SortKey)} className={selectClass}>
            <option value="name">Sort: Name A–Z</option>
            <option value="last_login">Sort: Last login</option>
            <option value="newest">Sort: Newest accounts</option>
          </select>
          <span className="text-sm text-gray-500 ml-auto">
            {visible.length === rows.length ? `${rows.length} users` : `${visible.length} of ${rows.length} users`}
          </span>
          {filtered && (
            <button onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })} className="text-sm text-amber-600 hover:text-amber-700 font-medium">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Users */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-success-gold"></div>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Text variant="muted" className="text-gray-600">
            {rows.length === 0 ? 'No users yet. Create the first one to get started.' : 'Nobody matches those filters.'}
          </Text>
        </div>
      ) : (
        <>
          {/* Phone layout */}
          <div className="lg:hidden space-y-3">
            {visible.map((r) => (
              <div key={r.id} className={`bg-white rounded-lg shadow-sm border p-4 ${r.suspicious ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  {r.name}
                  {r.suspicious && suspiciousPill}
                </div>
                {r.name !== r.email && <div className="text-sm text-gray-600 break-all">{r.email}</div>}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {me && (
                    <RoleLevelPicker actorRole={me.role} userId={r.id} role={r.role} level={r.level} isSelf={r.id === me.id} onChanged={fetchUsers} />
                  )}
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">{r.companyName}</span>
                  {statusPill(r.is_active)}
                </div>
                <div className="text-xs text-gray-500 mt-3">
                  Last login {formatDate(r.lastLogin)} · {r.logins7} logins this week
                </div>
                <div className="flex flex-wrap gap-2 pt-3 mt-3 border-t border-gray-200">{actionLinks(r, true)}</div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['User', 'Company', 'Role · Level', 'Status', 'Last login', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {visible.map((r) => (
                  <tr key={r.id} className={`hover:bg-gray-50 ${r.suspicious ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3">
                      <Link href={`/users/${r.id}`} className="text-sm font-medium text-gray-900 hover:text-amber-600 flex items-center gap-2">
                        {r.name}
                        {r.suspicious && suspiciousPill}
                      </Link>
                      {r.name !== r.email && <div className="text-sm text-gray-500">{r.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.companyName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {me && (
                        <RoleLevelPicker actorRole={me.role} userId={r.id} role={r.role} level={r.level} isSelf={r.id === me.id} onChanged={fetchUsers} />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{statusPill(r.is_active)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{formatDate(r.lastLogin)}</div>
                      <div className="text-xs text-gray-500">{r.logins7} this week</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-4">{actionLinks(r, false)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCreateModal && me && (
        <CreateAccountModal
          actorRole={me.role}
          companies={companies}
          companyId={filters.company && filters.company !== 'none' ? filters.company : undefined}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchUsers();
          }}
        />
      )}

      {resetting && (
        <ResetPasswordModal userId={resetting.id} name={resetting.name} email={resetting.email} onClose={() => setResetting(null)} />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-red-600 mb-2">Delete {deleting.name}?</h2>
            <p className="text-gray-600 mb-6">
              This removes their login and all their progress for good. To just lock them out, use Disable instead.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleting(null)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => handleDeleteUser(deleting.id)}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup orphaned users */}
      {showCleanupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Orphaned logins</h2>

            {orphanedUsers.length === 0 ? (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
                None found. Every login has a profile.
              </div>
            ) : (
              <>
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-4">
                  Found {orphanedUsers.length} login(s) with no profile.
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
                          <td className="px-4 py-2 text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-2 text-sm">
                            {user.email_confirmed_at ? <span className="text-green-600">Yes</span> : <span className="text-gray-400">No</span>}
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
                  {cleanupLoading ? 'Cleaning...' : `Delete ${orphanedUsers.length} login(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}
