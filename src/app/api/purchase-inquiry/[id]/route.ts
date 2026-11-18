import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/utils/security/superAdmin'

/**
 * PATCH /api/purchase-inquiry/[id]
 * Update a purchase inquiry (admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireSuperAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const body = await request.json()
    const { status } = body

    // Validate status
    if (!status || !['pending', 'contacted', 'completed', 'cancelled'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      )
    }

    // Use service role to bypass RLS
    const supabase = createServiceRoleClient()

    // Update the inquiry
    const updateData: any = {
      status,
    }

    // Set timestamps based on status
    if (status === 'contacted' || status === 'completed') {
      updateData.contacted_at = new Date().toISOString()
    }
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString()
    }

    const { data: inquiry, error } = await supabase
      .from('purchase_inquiries')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Failed to update purchase inquiry:', error)
      return NextResponse.json(
        { error: 'Failed to update inquiry', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ inquiry })
  } catch (error) {
    console.error('Error in PATCH /api/purchase-inquiry/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
