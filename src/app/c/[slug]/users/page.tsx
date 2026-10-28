'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Heading, Text, Card } from '@/components'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CreateAccountModal, RoleLevelPicker } from '@/components/users/AccountControls'

interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: string
  level: string | null
  is_active: boolean
  created_at: string
}

interface Company {
  id: string
  name: string
  account_limit: number | null
}

export default function CompanyUsersPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserProfile[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: myProfile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
      setMe({ id: user.id, role: myProfile?.role ?? 'user' })

      // Get the company from the URL slug (not the user's company)
      const { data: companyData } = await supabase
        .from('companies')
        .select('id, name, slug, account_limit')
        .eq('slug', slug)
        .single()

      if (!companyData) return
      setCompany(companyData as Company)

      // Fetch all users in THIS company
      const { data: companyUsers } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('company_id', companyData.id)
        .order('created_at', { ascending: false })

      if (companyUsers) {
        setUsers(companyUsers as UserProfile[])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/company/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus }),
      })

      if (!response.ok) {
        const data = await response.json()
        setMessage({ type: 'error', text: data.error || 'Failed to update user' })
        return
      }

      setMessage({ type: 'success', text: `User ${!currentStatus ? 'activated' : 'deactivated'} successfully!` })
      fetchData()

      // Auto-dismiss
      setTimeout(() => setMessage(null), 3000)
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update user' })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-success-gold"></div>
      </div>
    )
  }

  const activeUsers = users.filter(u => u.is_active).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div style={{ color: 'var(--company-primary)' }}>
            <Heading level={1} size="xl">User Management</Heading>
          </div>
          <Text variant="muted" className="mt-1">
            {company?.account_limit
              ? `${activeUsers} / ${company.account_limit} active users`
              : `${activeUsers} active users`
            }
          </Text>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 rounded-lg font-semibold text-white transition-all hover:opacity-90"
          style={{ backgroundColor: 'var(--company-primary)' }}
        >
          + Create User
        </button>
      </div>

      {/* Message Banner */}
      {message && (
        <div className={`p-4 rounded-lg border ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {message.text}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {users.length === 0 ? (
          <div className="text-center py-12">
            <Text variant="muted" className="text-gray-500">No users found</Text>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role · Level</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <Text className="font-medium text-gray-900">{user.display_name || 'No name'}</Text>
                    </td>
                    <td className="px-4 py-4">
                      <Text size="sm" className="text-gray-600">{user.email}</Text>
                    </td>
                    <td className="px-4 py-4">
                      {me && (
                        <RoleLevelPicker
                          actorRole={me.role}
                          userId={user.id}
                          role={user.role}
                          level={user.level}
                          isSelf={user.id === me.id}
                          onChanged={fetchData}
                          onError={(text) => setMessage({ type: 'error', text })}
                        />
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        user.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <Text size="sm" variant="muted" className="text-gray-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </Text>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/c/${slug}/users/${user.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: 'var(--company-primary)' }}
                        >
                          View Details
                        </Link>
                        <button
                          onClick={() => handleToggleActive(user.id, user.is_active)}
                          className="text-sm font-medium text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create User Modal: the same form SLAB admins use */}
      {showCreateModal && me && (
        <CreateAccountModal
          actorRole={me.role}
          companyId={company?.id}
          seatsNote={company?.account_limit ? `${activeUsers} / ${company.account_limit} active accounts used` : null}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            setMessage({ type: 'success', text: 'User created successfully!' })
            fetchData()
            setTimeout(() => setMessage(null), 4000)
          }}
        />
      )}
    </div>
  )
}
