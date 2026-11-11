'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { Heading, Text, Container } from '@/components';
import { ResetPasswordModal } from '@/components/users/ResetPasswordModal';
import { GoldenDoorCard } from '@/components/users/GoldenDoorCard';
import { ALL_ROLES, ROLE_LABELS, roleLabel, levelLabel } from '@/utils/users/roles';
import { vaultRepsFor } from '@/utils/users/vaultAccess';

interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  level: string | null;
  is_active: boolean;
  created_at: string;
  company_id: string | null;
  companies?: {
    id: string;
    name: string;
    slug: string;
  };
}

interface LoginLog {
  id: string;
  logged_in_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'training' | 'activity'>('details');
  const [showResetModal, setShowResetModal] = useState(false);

  // Quiz/Training progress
  const [quizProgress, setQuizProgress] = useState<any>(null);
  const [quizLoading, setQuizLoading] = useState(false);

  // Edit form
  const [editing, setEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('user');
  const [editCompanyId, setEditCompanyId] = useState('');
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [saveLoading, setSaveLoading] = useState(false);

  const fetchUserData = async () => {
    try {
      const response = await fetch(`/api/admin/users/${id}`);
      const data = await response.json();

      if (response.ok) {
        setProfile(data.profile);
        setLoginHistory(data.loginHistory);
        setEditDisplayName(data.profile.display_name || '');
        setEditRole(data.profile.role);
        setEditCompanyId(data.profile.company_id || '');
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
    setLoading(false);
  };

  const fetchCompanies = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('companies')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (data) {
      setCompanies(data);
    }
  };

  useEffect(() => {
    fetchUserData();
    fetchCompanies();
  }, [id]);

  useEffect(() => {
    if (activeTab === 'training') {
      fetchQuizProgress();
    }
  }, [activeTab]);

  const fetchQuizProgress = async () => {
    setQuizLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${id}/quiz-progress`);
      const data = await response.json();

      if (response.ok) {
        setQuizProgress(data);
      }
    } catch (error) {
      console.error('Error fetching quiz progress:', error);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editDisplayName,
          role: editRole,
          company_id: editCompanyId,
        }),
      });

      if (response.ok) {
        setEditing(false);
        fetchUserData();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save changes');
      }
    } catch (error) {
      alert('Failed to save changes');
    }
    setSaveLoading(false);
  };

  if (loading) {
    return (
      <Container maxWidth="xl" padding="lg">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-success-gold"></div>
        </div>
      </Container>
    );
  }

  if (!profile) {
    return (
      <Container maxWidth="xl" padding="lg">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Text variant="muted" className="text-gray-600">User not found</Text>
          <Link href="/users" className="text-success-gold hover:underline mt-4 inline-block">
            Back to Users
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" padding="lg">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/users" className="text-steel-gray hover:text-midnight-blue">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <Heading level={1} size="xl" className="truncate text-gray-900">
              {profile.display_name || profile.email}
            </Heading>
            <Text variant="muted" className="truncate text-gray-600">{profile.email}</Text>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className={`px-3 py-1 text-xs sm:text-sm font-medium rounded-full ${
            profile.role === 'super_admin'
              ? 'bg-purple-100 text-purple-700'
              : profile.role === 'company_admin'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-blue-100 text-blue-700'
          }`}>
            {roleLabel(profile.role)}
          </span>
          <span className="px-3 py-1 text-xs sm:text-sm font-medium rounded-full bg-gray-100 text-gray-700">
            {levelLabel(profile.level)}
          </span>
          <span className={`px-3 py-1 text-xs sm:text-sm font-medium rounded-full ${
            profile.is_active
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-700'
          }`}>
            {profile.is_active ? 'Active' : 'Disabled'}
          </span>
          <button
            onClick={() => setShowResetModal(true)}
            className="ml-auto px-3 py-1 text-xs sm:text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Reset password
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <div className="flex gap-4 sm:gap-8 min-w-max sm:min-w-0">
          {(['details', 'training', 'activity'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-1 border-b-2 font-medium capitalize transition-colors text-sm sm:text-base whitespace-nowrap ${
                activeTab === tab
                  ? 'border-success-gold text-success-gold'
                  : 'border-transparent text-steel-gray hover:text-midnight-blue'
              }`}
            >
              {tab === 'activity' ? 'Login Activity' : tab === 'training' ? 'Quiz Progress' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'details' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-success-gold"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-success-gold"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company
                </label>
                <select
                  value={editCompanyId}
                  onChange={(e) => setEditCompanyId(e.target.value)}
                  className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-success-gold"
                >
                  <option value="">Select company...</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveLoading}
                  className="px-4 py-2 bg-success-gold text-white rounded-lg hover:bg-amber-500 disabled:opacity-50"
                >
                  {saveLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 max-w-lg">
                <div>
                  <Text variant="muted" size="sm" className="text-gray-600">Email</Text>
                  <Text className="text-gray-900">{profile.email}</Text>
                </div>
                <div>
                  <Text variant="muted" size="sm" className="text-gray-600">Display Name</Text>
                  <Text className="text-gray-900">{profile.display_name || '-'}</Text>
                </div>
                <div>
                  <Text variant="muted" size="sm" className="text-gray-600">Role</Text>
                  <Text className="text-gray-900">{roleLabel(profile.role)}</Text>
                </div>
                <div>
                  <Text variant="muted" size="sm" className="text-gray-600">Company</Text>
                  <Text className="text-gray-900">{profile.companies?.name || '-'}</Text>
                </div>
                <div>
                  <Text variant="muted" size="sm" className="text-gray-600">Created</Text>
                  <Text className="text-gray-900">{new Date(profile.created_at).toLocaleDateString()}</Text>
                </div>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 bg-success-gold text-black font-medium rounded-lg hover:bg-amber-500"
              >
                Edit Details
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'details' && <GoldenDoorCard userId={id} />}

      {activeTab === 'details' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
          <Heading level={3} size="lg" className="text-gray-900">
            Vault access
          </Heading>
          <Text variant="muted" size="sm" className="mt-1 mb-3 text-gray-600">
            Set by their company. Nothing to subscribe: move them to another company to change it.
          </Text>
          <div className="flex flex-wrap gap-2">
            {vaultRepsFor(profile.companies).map((rep) => (
              <span key={rep} className="px-3 py-1 text-sm font-medium rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                {rep}
              </span>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'training' && (
        <div>
          {quizLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-success-gold"></div>
            </div>
          ) : !quizProgress ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
              <Text variant="muted" className="text-gray-600">Failed to load quiz progress</Text>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <Text variant="muted" size="sm" className="text-gray-600">Total Attempts</Text>
                  <Text className="text-2xl font-bold text-gray-900">{quizProgress.summary.totalAttempts}</Text>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <Text variant="muted" size="sm" className="text-gray-600">Videos Attempted</Text>
                  <Text className="text-2xl font-bold text-gray-900">{quizProgress.summary.uniqueVideos}</Text>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <Text variant="muted" size="sm" className="text-gray-600">Videos Passed</Text>
                  <Text className="text-2xl font-bold text-green-600">{quizProgress.summary.passedVideos}</Text>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <Text variant="muted" size="sm" className="text-gray-600">Average Score</Text>
                  <Text className="text-2xl font-bold text-gray-900">{quizProgress.summary.averageScore}%</Text>
                </div>
              </div>

              {/* Quiz Attempts by Video */}
              {quizProgress.videoProgress.length === 0 ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
                  <Text variant="muted" className="text-gray-600">No quiz attempts yet</Text>
                  <Text variant="muted" size="sm" className="mt-2 text-gray-500">
                    This user hasn't taken any quizzes
                  </Text>
                </div>
              ) : (
                <div className="space-y-4">
                  {quizProgress.videoProgress.map((videoData: any) => (
                    <div
                      key={videoData.video.id}
                      className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <Text variant="emphasis" className="text-lg font-semibold text-gray-900">
                              {videoData.video.title}
                            </Text>
                            {videoData.hasPassed ? (
                              <span className="px-3 py-1 text-sm font-medium bg-green-100 text-green-700 rounded-full">
                                ✓ Passed
                              </span>
                            ) : (
                              <span className="px-3 py-1 text-sm font-medium bg-red-100 text-red-700 rounded-full">
                                Not Passed
                              </span>
                            )}
                          </div>
                          <Text variant="muted" size="sm" className="mt-1 text-gray-600">
                            {videoData.totalAttempts} attempt{videoData.totalAttempts !== 1 ? 's' : ''} •
                            Best Score: {videoData.bestAttempt.score}%
                          </Text>
                        </div>
                      </div>

                      {/* Attempts Table */}
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Attempt
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Score
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Questions
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Status
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Date
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {videoData.allAttempts.map((attempt: any) => (
                              <tr key={attempt.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900">
                                  #{attempt.attempt_number}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`text-sm font-semibold ${
                                    attempt.score >= 80 ? 'text-green-600' :
                                    attempt.score >= 60 ? 'text-amber-600' : 'text-red-600'
                                  }`}>
                                    {attempt.score}%
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {attempt.correct_answers}/{attempt.total_questions}
                                </td>
                                <td className="px-4 py-3">
                                  {attempt.passed ? (
                                    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                                      Passed
                                    </span>
                                  ) : (
                                    <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                                      Failed
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500">
                                  {new Date(attempt.completed_at).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div>
          <Text variant="muted" className="mb-4 text-gray-600">
            Last 50 login attempts
          </Text>

          {loginHistory.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
              <Text variant="muted" className="text-gray-600">No login activity recorded</Text>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date & Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      IP Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Device
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loginHistory.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {new Date(log.logged_in_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {log.ip_address || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {log.user_agent || 'Unknown'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showResetModal && (
        <ResetPasswordModal
          userId={profile.id}
          name={profile.display_name || profile.email}
          email={profile.email}
          onClose={() => setShowResetModal(false)}
        />
      )}
    </Container>
  );
}
