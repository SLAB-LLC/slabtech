'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAudioUpload } from '@/hooks/useAudioUpload';
import { useLockedSections } from '@/hooks/useLockedSections';

interface Transcript {
  id: string;
  created_at: string;
  salesperson_name: string;
  original_filename: string;
}

interface Salesperson {
  id: string;
  name: string;
  display_order: number;
  profile_picture_url?: string;
  about?: string;
}

interface Playlist {
  objectionType: string;
  conversationCount: number;
}

export default function CompanyDashboard() {
  const params = useParams();
  const slug = params?.slug as string;
  const [userRole, setUserRole] = useState<'super_admin' | 'company_admin' | 'user' | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'transcripts' | 'playlists' | 'favorites'>('transcripts');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [expandedSalespeople, setExpandedSalespeople] = useState<Set<string>>(new Set());
  const [salespeopleProfiles, setSalespeopleProfiles] = useState<Record<string, Salesperson>>({});
  const [repNames, setRepNames] = useState<string[]>([]);
  const [streakData, setStreakData] = useState<{
    current_streak: number;
    longest_streak: number;
    activity_days: number[];
  }>({ current_streak: 0, longest_streak: 0, activity_days: [] });
  const [companyRank, setCompanyRank] = useState<number | null>(null);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [uploadingProfilePic, setUploadingProfilePic] = useState(false);
  const [companyId, setCompanyId] = useState<string>('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<string>('');

  // Admin dashboard data (for super_admin)
  const [companyUsers, setCompanyUsers] = useState<any[]>([]);
  const [loginLogs, setLoginLogs] = useState<any[]>([]);
  const [companyName, setCompanyName] = useState<string>('');

  // Ref for content section
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [salespersonId, setSalespersonId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { loading: uploadLoading, uploadProgress, message, uploadAudio } = useAudioUpload({
    onSuccess: () => {
      setSalespersonId('');
      setFile(null);
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    },
  });

  const { transcripts: transcriptsLock, trainingPlaylists: trainingPlaylistsLock } = useLockedSections();

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setUserEmail(user.email || '');

      // Get user profile with role
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('display_name, profile_picture_url, company_id, role')
        .eq('id', user.id)
        .single();

      setUserName(userProfile?.display_name || 'User');
      setProfilePictureUrl(userProfile?.profile_picture_url || null);
      setUserRole(userProfile?.role || 'user');

      // Get the company from URL slug
      const { data: company } = await supabase
        .from('companies')
        .select('id, name')
        .eq('slug', slug)
        .single();

      if (company) {
        setCompanyId(company.id);
        setCompanyName(company.name);
      }

      // If super_admin, fetch admin dashboard data
      if (userProfile?.role === 'super_admin') {
        // Fetch company users
        const { data: users } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('company_id', company?.id)
          .order('created_at', { ascending: false });

        if (users) {
          setCompanyUsers(users);
        }

        // Fetch login history
        const { data: logs } = await supabase
          .from('login_logs')
          .select('*, user_profiles!inner(email, display_name)')
          .eq('company_id', company?.id)
          .order('logged_in_at', { ascending: false })
          .limit(20);

        if (logs) {
          setLoginLogs(logs);
        }

        setLoading(false);
        return; // Skip personal data fetching for super admin
      }

      // For company_admin and regular users, fetch personal data
      if (user) {

        // 1. Get assigned transcript IDs
        const { data: assignments } = await supabase
          .from('transcript_assignments')
          .select('transcript_id')
          .eq('user_id', user.id);

        const assignedIds = assignments?.map(a => a.transcript_id) || [];

        // 2. Get subscribed salespeople
        const { data: subscriptions } = await supabase
          .from('salesperson_subscriptions')
          .select('salesperson_name')
          .eq('user_id', user.id);

        const salespersonNames = subscriptions?.map(s => s.salesperson_name) || [];

        // 3. Get transcript IDs for subscribed salespeople
        let subscribedIds: string[] = [];
        if (salespersonNames.length > 0) {
          const { data: subscribedTranscripts } = await supabase
            .from('transcripts')
            .select('id')
            .in('salesperson_name', salespersonNames);

          subscribedIds = subscribedTranscripts?.map(t => t.id) || [];
        }

        // 4. Combine both sets of transcript IDs (remove duplicates)
        const allTranscriptIds = Array.from(new Set([...assignedIds, ...subscribedIds]));

        // 5. Fetch all transcripts by combined IDs
        if (allTranscriptIds.length > 0) {
          const { data: transcriptData } = await supabase
            .from('transcripts')
            .select('id, created_at, salesperson_name, original_filename')
            .in('id', allTranscriptIds)
            .order('created_at', { ascending: false });

          if (transcriptData) {
            setTranscripts(transcriptData);
            setRepNames(Array.from(new Set(transcriptData.map((t: { salesperson_name?: string | null }) => t.salesperson_name).filter((n): n is string => !!n))));
          }
        }
      }

      // Fetch salespeople for upload form and profiles
      const response = await fetch('/api/salespeople');
      const data = await response.json();
      if (data.salespeople) {
        setSalespeople(data.salespeople);

        // Create a mapping of salesperson name to profile data
        const profilesMap: Record<string, Salesperson> = {};
        data.salespeople.forEach((sp: Salesperson) => {
          profilesMap[sp.name] = sp;
        });
        setSalespeopleProfiles(profilesMap);
      }

      // Fetch streak data
      try {
        const streakResponse = await fetch('/api/streak');
        if (streakResponse.ok) {
          const streakJson = await streakResponse.json();
          setStreakData({
            current_streak: streakJson.current_streak || 0,
            longest_streak: streakJson.longest_streak || 0,
            activity_days: streakJson.activity_days || [],
          });
        }
      } catch (error) {
        console.error('Error fetching streak data:', error);
      }

      // Fetch company rank (for regular users)
      if (userProfile?.role !== 'super_admin' && company) {
        try {
          // Get all active users in the company
          const { data: companyUsers } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('company_id', company.id)
            .eq('is_active', true);

          if (companyUsers && companyUsers.length > 0) {
            // Get streak data for these users
            const userIds = companyUsers.map(u => u.id);
            const { data: streaks } = await supabase
              .from('user_streaks')
              .select('user_id, current_streak, longest_streak')
              .in('user_id', userIds);

            // Merge and sort
            const leaderboardData = companyUsers.map((u) => {
              const userStreak = streaks?.find(s => s.user_id === u.id);
              return {
                user_id: u.id,
                current_streak: userStreak?.current_streak || 0,
                longest_streak: userStreak?.longest_streak || 0,
              };
            });

            leaderboardData.sort((a, b) => {
              if (b.current_streak !== a.current_streak) {
                return b.current_streak - a.current_streak;
              }
              return b.longest_streak - a.longest_streak;
            });

            // Find user's rank
            const rank = leaderboardData.findIndex(s => s.user_id === user.id) + 1;
            if (rank > 0) {
              setCompanyRank(rank);
            }
          }
        } catch (error) {
          console.error('Error fetching company rank:', error);
        }
      }

      setLoading(false);
    };

    fetchData();
  }, []);

  // Fetch playlists when playlists tab is activated
  useEffect(() => {
    if (activeTab === 'playlists' && playlists.length === 0 && !playlistsLoading) {
      const fetchPlaylists = async () => {
        setPlaylistsLoading(true);
        try {
          const response = await fetch('/api/user/playlists');
          const data = await response.json();
          if (data.playlists) {
            setPlaylists(data.playlists);
          }
        } catch (error) {
          console.error('Error fetching playlists:', error);
        } finally {
          setPlaylistsLoading(false);
        }
      };
      fetchPlaylists();
    }
  }, [activeTab, playlists.length, playlistsLoading]);

  // Fetch favorites when favorites tab is activated
  useEffect(() => {
    if (activeTab === 'favorites') {
      const fetchFavorites = async () => {
        setFavoritesLoading(true);
        try {
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            setFavoritesLoading(false);
            return;
          }

          console.log('Fetching favorites for user:', user.id);

          // Get favorites first
          const { data: favoritesData, error: favError } = await supabase
            .from('user_favorites')
            .select('id, conversation_id, note, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

          if (favError) {
            console.error('Error fetching favorites:', favError);
            alert(`Error loading favorites: ${favError.message}`);
            setFavoritesLoading(false);
            return;
          }

          console.log('Raw favorites:', favoritesData);

          if (!favoritesData || favoritesData.length === 0) {
            setFavorites([]);
            setFavoritesLoading(false);
            return;
          }

          // Get conversation IDs
          const conversationIds = favoritesData.map(f => f.conversation_id);

          // Fetch conversations with transcript info
          const { data: conversationsData, error: convError } = await supabase
            .from('conversations')
            .select('id, conversation_number, transcript_id, transcripts(id, salesperson_name, original_filename, created_at)')
            .in('id', conversationIds);

          if (convError) {
            console.error('Error fetching conversations:', convError);
            alert(`Error loading conversation details: ${convError.message}`);
            setFavoritesLoading(false);
            return;
          }

          console.log('Conversations data:', conversationsData);

          // Merge the data
          const mergedData = favoritesData.map(fav => {
            const conversation = conversationsData?.find(c => c.id === fav.conversation_id);
            return {
              ...fav,
              conversations: conversation
            };
          });

          console.log('Merged favorites:', mergedData);
          setFavorites(mergedData);
        } catch (error) {
          console.error('Unexpected error fetching favorites:', error);
          alert(`Unexpected error: ${error}`);
        } finally {
          setFavoritesLoading(false);
        }
      };
      fetchFavorites();
    }
  }, [activeTab]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const handleBoxClick = (tab: 'upload' | 'transcripts' | 'playlists' | 'favorites') => {
    setActiveTab(tab);
    // Scroll to content section after a brief delay to allow state update
    setTimeout(() => {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleProfilePictureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingProfilePic(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Upload to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('profile-pictures')
        .getPublicUrl(fileName);

      // Update user profile
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ profile_picture_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setProfilePictureUrl(publicUrl);
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      alert('Failed to upload profile picture. Please try again.');
    } finally {
      setUploadingProfilePic(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !salespersonId) return;
    await uploadAudio(file, salespersonId);
  };

  const handleEditNote = (favoriteId: string, currentNote: string | null) => {
    setEditingNoteId(favoriteId);
    setNoteText(currentNote || '');
  };

  const handleSaveNote = async (favoriteId: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('user_favorites')
        .update({ note: noteText.trim() || null })
        .eq('id', favoriteId);

      if (error) {
        console.error('Error saving note:', error);
        alert('Failed to save note');
        return;
      }

      // Update local state
      setFavorites(prev =>
        prev.map(fav =>
          fav.id === favoriteId ? { ...fav, note: noteText.trim() || null } : fav
        )
      );
      setEditingNoteId(null);
      setNoteText('');
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Failed to save note');
    }
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setNoteText('');
  };

  const toggleSalesperson = (name: string) => {
    setExpandedSalespeople(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  // Group transcripts by salesperson
  const transcriptsBySalesperson = transcripts.reduce((acc, transcript) => {
    const name = transcript.salesperson_name;
    if (!acc[name]) {
      acc[name] = [];
    }
    acc[name].push(transcript);
    return acc;
  }, {} as Record<string, Transcript[]>);

  const selectedSalesperson = salespeople.find(sp => sp.id === salespersonId);

  // Get fire color based on week (cycles every 7 days)
  const getFireColorByWeek = (streak: number) => {
    const week = Math.floor((streak - 1) / 7) % 6; // 0-5 for 6 color cycles
    const colors = [
      { bg: 'bg-red-500', text: 'text-red-500', shadow: 'shadow-red-500/50' }, // Week 1
      { bg: 'bg-orange-500', text: 'text-orange-500', shadow: 'shadow-orange-500/50' }, // Week 2
      { bg: 'bg-blue-500', text: 'text-blue-500', shadow: 'shadow-blue-500/50' }, // Week 3
      { bg: 'bg-purple-500', text: 'text-purple-500', shadow: 'shadow-purple-500/50' }, // Week 4
      { bg: 'bg-yellow-500', text: 'text-yellow-500', shadow: 'shadow-yellow-500/50' }, // Week 5 (Gold)
      { bg: 'bg-green-500', text: 'text-green-500', shadow: 'shadow-green-500/50' }, // Week 6
    ];
    return colors[week];
  };

  const fireColor = getFireColorByWeek(streakData.current_streak || 1);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Super Admin Dashboard
  if (userRole === 'super_admin') {
    return (
      <main className="min-h-screen bg-gray-50">
        <header className="bg-pure-white border-b-2 border-midnight-blue">
          <nav className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/">
                  <Image src="/slab-logo.png" alt="SLAB" width={60} height={60} className="h-[60px] w-auto" priority />
                </Link>
                <div className="border-l-2 border-midnight-blue pl-3">
                  <span className="text-xl font-bold text-midnight-blue">{companyName}</span>
                  <span className="text-xs text-steel-gray ml-2">Super Admin View</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Link
                  href="/admin"
                  className="text-sm text-steel-gray transition-colors font-medium"
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--company-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = ''}
                >
                  ← Admin
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-sm text-steel-gray transition-colors font-medium"
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--company-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = ''}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </nav>
        </header>

        <div className="max-w-7xl mx-auto px-6 py-8">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--company-primary)' }}></div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Company Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg shadow-sm border-2 p-6" style={{ borderColor: 'var(--company-primary)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Users</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">{companyUsers.length}</p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--company-primary)' }}>
                      <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border-2 border-green-500 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Active Users</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">{companyUsers.filter(u => u.is_active).length}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-green-500">
                      <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border-2 border-gray-300 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Inactive Users</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">{companyUsers.filter(u => !u.is_active).length}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-400">
                      <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Login Activity */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Login Activity</h2>
                {loginLogs.length === 0 ? (
                  <p className="text-gray-500">No login activity yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {loginLogs.map((log: any) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {log.user_profiles?.display_name || log.user_profiles?.email}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(log.logged_in_at)}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{log.ip_address || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Link href={`/c/${slug}/users`} className="group">
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-full transition-all hover:shadow-md hover:border-gray-300">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-md font-semibold mb-2 text-gray-900">Manage Users</h3>
                        <p className="text-gray-600">Add, edit, or remove user accounts</p>
                      </div>
                      <span className="transition-transform group-hover:translate-x-1" style={{ color: 'var(--company-primary)' }}>→</span>
                    </div>
                  </div>
                </Link>

                <Link href={`/c/${slug}/leaderboard`} className="group">
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-full transition-all hover:shadow-md hover:border-gray-300">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-md font-semibold mb-2 text-gray-900">View Leaderboard</h3>
                        <p className="text-gray-600">See all user streaks and rankings</p>
                      </div>
                      <span className="transition-transform group-hover:translate-x-1" style={{ color: 'var(--company-primary)' }}>→</span>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Company Admin & Regular User Dashboard
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-pure-white border-b-2 border-midnight-blue">
        <nav className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Image
                  src="/slab-logo.png"
                  alt="SLAB"
                  width={60}
                  height={60}
                  className="h-[60px] w-auto"
                  priority
                />
              </Link>
              <div className="border-l-2 border-midnight-blue pl-3">
                <span className="text-xl font-bold text-midnight-blue">{userName}</span>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="text-sm text-steel-gray transition-colors font-medium"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--company-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = ''}
            >
              Sign Out
            </button>
          </div>
        </nav>
      </header>

      {/* Main Dashboard Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Side - Profile & Streak */}
          <div className="lg:w-1/3 space-y-6">
            {/* Profile Picture Card */}
            <div className="bg-white rounded-lg shadow p-6 flex lg:flex-col items-center gap-4">
              {/* Circular Profile Picture */}
              <div className="relative group">
                {profilePictureUrl ? (
                  <img
                    src={profilePictureUrl}
                    alt={userName}
                    className="w-32 h-32 rounded-full object-cover group-hover:opacity-90 transition-opacity"
                  />
                ) : (
                  <div
                    className="w-32 h-32 rounded-full flex items-center justify-center text-white font-bold text-4xl group-hover:opacity-90 transition-opacity"
                    style={{
                      background: `linear-gradient(to bottom right, var(--company-primary), var(--company-secondary))`
                    }}
                  >
                    {userName.charAt(0).toUpperCase()}
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingProfilePic}
                  className="absolute bottom-0 right-0 bg-midnight-blue text-white p-2 rounded-full hover:bg-steel-gray transition-colors disabled:opacity-50"
                >
                  {uploadingProfilePic ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleProfilePictureUpload}
                />
              </div>

              {/* User Info - Show on mobile */}
              <div className="lg:hidden text-center">
                <p className="font-semibold text-midnight-blue">{userName}</p>
                <p className="text-sm text-steel-gray">{userEmail}</p>
              </div>
            </div>

            {/* Week Streak Counter */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-midnight-blue mb-4 text-center">Listening Streak</h3>

              {/* Week View */}
              <div className="flex justify-between mb-4">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => {
                  const isActive = streakData.activity_days.includes(index);
                  const isToday = index === new Date().getDay();
                  return (
                    <div key={index} className="flex flex-col items-center gap-2">
                      <span className="text-xs text-steel-gray font-medium">{day}</span>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                        isActive
                          ? `${fireColor.bg} text-white shadow-lg ${fireColor.shadow} ${isToday ? 'animate-pulse' : ''}`
                          : 'bg-gray-100 text-gray-400'
                      }`}>
                        {isActive ? (
                          <span className={`text-xl ${isToday ? 'animate-bounce' : ''}`}>🔥</span>
                        ) : (
                          '○'
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Streak Number */}
              <div className="text-center pt-4 border-t border-gray-200">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <span className={`text-2xl ${fireColor.text} animate-pulse`}>🔥</span>
                  <p className={`text-3xl font-bold ${fireColor.text}`}>{streakData.current_streak}</p>
                  <span className={`text-2xl ${fireColor.text} animate-pulse`}>🔥</span>
                </div>
                <p className="text-sm text-steel-gray">Day Streak</p>
                {streakData.longest_streak > streakData.current_streak && (
                  <p className="text-xs text-steel-gray mt-1">Best: {streakData.longest_streak} days</p>
                )}

                {/* Company Rank */}
                {companyRank && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm text-steel-gray">Company Rank:</span>
                      <div className="flex items-center gap-1">
                        {companyRank === 1 && <span className="text-2xl">🥇</span>}
                        {companyRank === 2 && <span className="text-2xl">🥈</span>}
                        {companyRank === 3 && <span className="text-2xl">🥉</span>}
                        <span className={`text-xl font-bold ${companyRank <= 3 ? 'text-amber-600' : 'text-midnight-blue'}`}>
                          #{companyRank}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/c/${slug}/leaderboard`}
                      className="text-xs mt-1 inline-block transition-colors"
                      style={{ color: 'var(--company-primary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      View Leaderboard →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Side - Grid of Navigation Boxes */}
          <div className="lg:w-2/3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Recordings Box */}
              <div
                onClick={() => !transcriptsLock.locked && handleBoxClick('transcripts')}
                className={`bg-white rounded-lg shadow p-6 transition-shadow border-2 ${
                  transcriptsLock.locked
                    ? 'opacity-75 cursor-not-allowed border-gray-300'
                    : 'cursor-pointer hover:shadow-lg border-transparent'
                }`}
                onMouseEnter={(e) => { if (!transcriptsLock.locked) e.currentTarget.style.borderColor = 'var(--company-primary)' }}
                onMouseLeave={(e) => { if (!transcriptsLock.locked) e.currentTarget.style.borderColor = 'transparent' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-midnight-blue">Recordings</h3>
                    {transcriptsLock.locked && <span className="text-xl">🔒</span>}
                  </div>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                {transcriptsLock.locked ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Complete required quiz to unlock</p>
                    <Link href={`/c/${slug}/training`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Go to Training →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {repNames.length > 0 ? (
                      repNames.slice(0, 3).map((name, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                            style={{
                              background: `linear-gradient(to bottom right, var(--company-primary), var(--company-secondary))`
                            }}
                          >
                            {name.charAt(0)}
                          </div>
                          <span className="text-sm text-steel-gray">{name}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-steel-gray">No recordings yet</p>
                    )}
                    {repNames.length > 3 && (
                      <p className="text-xs text-steel-gray">+{repNames.length - 3} more</p>
                    )}
                  </div>
                )}
              </div>

              {/* Training Playlists Box */}
              <div
                onClick={() => !trainingPlaylistsLock.locked && handleBoxClick('playlists')}
                className={`bg-white rounded-lg shadow p-6 transition-shadow border-2 ${
                  trainingPlaylistsLock.locked
                    ? 'opacity-75 cursor-not-allowed border-gray-300'
                    : 'cursor-pointer hover:shadow-lg border-transparent'
                }`}
                onMouseEnter={(e) => { if (!transcriptsLock.locked) e.currentTarget.style.borderColor = 'var(--company-primary)' }}
                onMouseLeave={(e) => { if (!transcriptsLock.locked) e.currentTarget.style.borderColor = 'transparent' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-midnight-blue">Training Playlists</h3>
                    {trainingPlaylistsLock.locked && <span className="text-xl">🔒</span>}
                  </div>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                {trainingPlaylistsLock.locked ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Complete required quiz to unlock</p>
                    <Link href={`/c/${slug}/training`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Go to Training →
                    </Link>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-steel-gray">Practice specific objection handling</p>
                    <p className="text-3xl font-bold mt-4" style={{ color: 'var(--company-primary)' }}>{playlists.length}</p>
                    <p className="text-xs text-steel-gray">Available playlists</p>
                  </>
                )}
              </div>

              {/* Favorites Box */}
              <div
                onClick={() => handleBoxClick('favorites')}
                className="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition-shadow border-2 border-transparent"
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--company-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-midnight-blue">Favorites</h3>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <p className="text-sm text-steel-gray">Save and review your favorite conversations</p>
                <p className="text-3xl font-bold mt-4" style={{ color: 'var(--company-primary)' }}>{favorites.length}</p>
                <p className="text-xs text-steel-gray">Saved favorites</p>
              </div>

              {/* AI Roleplay Box */}
              <div className="bg-white rounded-lg shadow p-6 cursor-not-allowed opacity-60 border-2 border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-midnight-blue">AI Roleplay</h3>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-sm text-steel-gray">Practice with AI-powered scenarios</p>
                <p className="text-xs text-amber-600 mt-4">Coming Soon</p>
              </div>

              {/* Company Training Videos Box */}
              <Link
                href={`/c/${slug}/training`}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-2 border-transparent block"
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--company-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-midnight-blue">Company Training</h3>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-steel-gray">Company-specific training videos and resources</p>
              </Link>

              {/* Company Leaderboard Box */}
              <Link
                href={`/c/${slug}/leaderboard`}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-2 border-transparent block"
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--company-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-midnight-blue">Company Leaderboard</h3>
                  <svg className="w-6 h-6" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                </div>
                <p className="text-sm text-steel-gray">See how you rank against your teammates</p>
                {companyRank && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2">
                      {companyRank === 1 && <span className="text-2xl">🥇</span>}
                      {companyRank === 2 && <span className="text-2xl">🥈</span>}
                      {companyRank === 3 && <span className="text-2xl">🥉</span>}
                      <span className="text-3xl font-bold" style={{ color: 'var(--company-primary)' }}>#{companyRank}</span>
                    </div>
                    <p className="text-xs text-steel-gray">Your rank</p>
                  </div>
                )}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Active Tab Content - Shown when a box is clicked */}
      {activeTab !== null && (
      <div ref={contentRef} className="max-w-7xl mx-auto px-6 pb-8">
        {activeTab === 'transcripts' ? (
          /* Transcripts List */
          <div>
            <h1 className="text-2xl font-bold text-midnight-blue mb-6">Your Transcripts</h1>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--company-primary)' }}></div>
              </div>
            ) : transcripts.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-steel-gray">No transcripts have been assigned to you yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(transcriptsBySalesperson).map(([salespersonName, salespersonTranscripts]) => {
                  const isExpanded = expandedSalespeople.has(salespersonName);
                  const profile = salespeopleProfiles[salespersonName];
                  return (
                    <div key={salespersonName} className="bg-white rounded-lg shadow overflow-hidden">
                      {/* Accordion Header */}
                      <button
                        onClick={() => toggleSalesperson(salespersonName)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          {/* Profile Picture */}
                          {profile?.profile_picture_url ? (
                            <img
                              src={profile.profile_picture_url}
                              alt={salespersonName}
                              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div
                              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                              style={{
                                background: `linear-gradient(to bottom right, var(--company-primary), var(--company-secondary))`
                              }}
                            >
                              {salespersonName.charAt(0).toUpperCase()}
                            </div>
                          )}

                          {/* Name, Badge, and About */}
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="text-lg font-semibold text-midnight-blue">{salespersonName}</span>
                              <span
                                className="px-3 py-1 text-sm font-medium rounded-full whitespace-nowrap"
                                style={{
                                  backgroundColor: 'color-mix(in srgb, var(--company-primary) 10%, transparent)',
                                  color: 'var(--company-primary)'
                                }}
                              >
                                {salespersonTranscripts.length} {salespersonTranscripts.length === 1 ? 'recording' : 'recordings'}
                              </span>
                            </div>
                            {profile?.about && (
                              <p className="text-sm text-steel-gray line-clamp-1 pr-4">{profile.about}</p>
                            )}
                          </div>
                        </div>

                        <svg
                          className={`w-5 h-5 text-steel-gray transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Accordion Content */}
                      {isExpanded && (
                        <div className="border-t border-gray-200">
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Date
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Filename
                                  </th>
                                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {salespersonTranscripts.map((transcript) => (
                                  <tr key={transcript.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {new Date(transcript.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                      {transcript.original_filename}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                                      <Link
                                        href={`/user/transcripts/${transcript.id}`}
                                        className="font-medium transition-colors"
                                        style={{ color: 'var(--company-primary)' }}
                                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                      >
                                        View
                                      </Link>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'playlists' ? (
          /* Training Playlists */
          <div>
            <h1 className="text-2xl font-bold text-midnight-blue mb-6">Training Playlists</h1>
            <p className="text-steel-gray mb-6">
              Practice handling specific objections by listening to real conversations grouped by objection type.
            </p>

            {playlistsLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--company-primary)' }}></div>
              </div>
            ) : playlists.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-steel-gray">No training playlists available yet. Playlists will appear as conversations are uploaded.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {playlists.map((playlist) => {
                  const objectionLabels: Record<string, string> = {
                    diy: 'DIY Objections',
                    spouse: 'Spouse Objections',
                    price: 'Price Objections',
                    competitor: 'Competitor Objections',
                    delay: 'Delay/Timing Objections',
                    not_interested: 'Not Interested',
                    no_problem: 'No Problem Objections',
                    no_soliciting: 'No Soliciting'
                  };

                  const objectionIcons: Record<string, string> = {
                    delay: '⏰',
                    not_interested: '🚫',
                    diy: '🔨',
                    no_problem: '❌',
                    spouse: '👥',
                    competitor: '🏢',
                    price: '💰',
                    no_soliciting: '🚪',
                  };

                  return (
                    <Link
                      key={playlist.objectionType}
                      href={`/user/playlists/${playlist.objectionType}`}
                      className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 border-2 border-transparent"
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--company-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{objectionIcons[playlist.objectionType]}</span>
                          <h3 className="text-lg font-semibold text-midnight-blue">
                            {objectionLabels[playlist.objectionType] || playlist.objectionType}
                          </h3>
                        </div>
                        <svg className="w-5 h-5" style={{ color: 'var(--company-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-3xl font-bold" style={{ color: 'var(--company-primary)' }}>{playlist.conversationCount}</span>
                        <span className="text-steel-gray">
                          {playlist.conversationCount === 1 ? 'conversation' : 'conversations'}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'favorites' ? (
          /* Favorites */
          <div>
            <h1 className="text-2xl font-bold text-midnight-blue mb-6">Your Favorites</h1>
            <p className="text-steel-gray mb-6">
              Conversations you've saved for later review and practice.
            </p>

            {favoritesLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--company-primary)' }}></div>
              </div>
            ) : favorites.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <p className="text-steel-gray">No favorites yet. Star conversations to save them here!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {favorites.map((favorite: any) => {
                  const conversation = favorite.conversations;
                  const transcript = conversation?.transcripts;
                  if (!conversation || !transcript) {
                    console.log('Missing data for favorite:', favorite);
                    return null;
                  }

                  return (
                    <div
                      key={favorite.id}
                      className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow border-2 border-transparent overflow-hidden"
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--company-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              {/* Salesperson initial */}
                              <div
                                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                                style={{
                                  background: `linear-gradient(to bottom right, var(--company-primary), var(--company-secondary))`
                                }}
                              >
                                {transcript.salesperson_name?.charAt(0).toUpperCase() || '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-semibold text-midnight-blue truncate">
                                  {transcript.salesperson_name} - Conversation #{conversation.conversation_number}
                                </h3>
                                <p className="text-sm text-steel-gray truncate">{transcript.original_filename}</p>
                              </div>
                            </div>

                            {/* Note section */}
                            <div className="ml-13 mt-3">
                              {editingNoteId === favorite.id ? (
                                /* Edit mode */
                                <div className="space-y-2">
                                  <textarea
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    placeholder="Add a note about why you saved this conversation..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent resize-none"
                                    style={{ '--tw-ring-color': 'var(--company-primary)' } as React.CSSProperties}
                                    rows={3}
                                  />
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <button
                                      onClick={() => handleSaveNote(favorite.id)}
                                      className="px-4 py-3 sm:py-2 text-white text-sm font-medium rounded-lg transition-colors active:scale-95"
                                      style={{ backgroundColor: 'var(--company-primary)' }}
                                      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                                      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                    >
                                      Save Note
                                    </button>
                                    <button
                                      onClick={handleCancelEdit}
                                      className="px-4 py-3 sm:py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors active:scale-95"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : favorite.note ? (
                                /* Display mode with note */
                                <div
                                  className="bg-amber-50 border-l-4 p-3 rounded"
                                  style={{ borderColor: 'var(--company-primary)' }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm text-steel-gray italic flex-1">&quot;{favorite.note}&quot;</p>
                                    <button
                                      onClick={() => handleEditNote(favorite.id, favorite.note)}
                                      className="text-sm font-medium flex-shrink-0 px-2 py-1 -mr-2 active:scale-95 transition-all"
                                      style={{ color: 'var(--company-primary)' }}
                                      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* No note - show add button */
                                <button
                                  onClick={() => handleEditNote(favorite.id, null)}
                                  className="text-sm font-medium flex items-center gap-1 py-2 active:scale-95 transition-all"
                                  style={{ color: 'var(--company-primary)' }}
                                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                >
                                  <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add a note
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Star icon */}
                          <svg className="w-6 h-6 fill-current flex-shrink-0" style={{ color: 'var(--company-primary)' }} viewBox="0 0 24 24">
                            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </div>

                        {/* Footer with date and actions */}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                          <span className="text-xs text-steel-gray">
                            Saved {new Date(favorite.created_at).toLocaleDateString()}
                          </span>
                          <Link
                            href={`/user/transcripts/${transcript.id}`}
                            className="font-medium text-sm flex items-center gap-1 transition-colors"
                            style={{ color: 'var(--company-primary)' }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                          >
                            View Conversation
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7-7" />
                            </svg>
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Upload Form */
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-midnight-blue mb-6">Upload New Recording</h1>

            <div className="bg-white rounded-lg shadow p-8">
              <form onSubmit={handleUpload} className="space-y-6">
                {/* Salesperson Selection */}
                <div>
                  <label className="block text-sm font-medium text-midnight-blue mb-2">
                    Select Salesperson <span className="text-red-500">*</span>
                  </label>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                      disabled={uploadLoading}
                      className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-left focus:ring-2 focus:border-transparent transition-all hover:border-gray-400 disabled:opacity-50"
                      style={{ '--tw-ring-color': 'var(--company-primary)' } as React.CSSProperties}
                    >
                      <div className="flex items-center justify-between">
                        <span className={selectedSalesperson ? 'text-charcoal' : 'text-gray-400'}>
                          {selectedSalesperson ? selectedSalesperson.name : 'Choose a salesperson'}
                        </span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {dropdownOpen && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {salespeople.map((sp) => (
                          <button
                            key={sp.id}
                            type="button"
                            onClick={() => {
                              setSalespersonId(sp.id);
                              setDropdownOpen(false);
                            }}
                            className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                              salespersonId === sp.id ? '' : 'text-charcoal'
                            }`}
                            style={salespersonId === sp.id ? {
                              backgroundColor: 'color-mix(in srgb, var(--company-primary) 10%, transparent)',
                              color: 'var(--company-primary)'
                            } : undefined}
                          >
                            {sp.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* File Upload */}
                <div>
                  <label className="block text-sm font-medium text-midnight-blue mb-2">
                    Audio File <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                    file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400'
                  }`}>
                    {file ? (
                      <div className="text-green-600 pointer-events-none">
                        <svg className="mx-auto h-10 w-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm">({Math.round(file.size / 1024 / 1024)}MB)</p>
                      </div>
                    ) : (
                      <div className="text-gray-500 pointer-events-none">
                        <svg className="mx-auto h-10 w-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-sm">Drop an audio file here or click to browse</p>
                        <p className="text-xs mt-1">MP3, WAV, or other audio formats (max 200MB)</p>
                      </div>
                    )}
                    <input
                      id="file-upload"
                      type="file"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0];
                        if (selectedFile) setFile(selectedFile);
                      }}
                      disabled={uploadLoading}
                    />
                  </div>
                </div>

                {/* Message */}
                {message && (
                  <div className={`rounded-lg p-4 ${
                    message.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    {message.text}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={uploadLoading || !salespersonId || !file}
                  className="w-full py-3 px-4 text-white font-semibold rounded-lg focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  style={{
                    backgroundColor: 'var(--company-primary)',
                    '--tw-ring-color': 'var(--company-primary)'
                  } as React.CSSProperties}
                  onMouseEnter={(e) => !uploadLoading && (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {uploadLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {uploadProgress || 'Processing...'}
                    </span>
                  ) : (
                    'Upload and Process'
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
      )}
    </main>
  );
}
