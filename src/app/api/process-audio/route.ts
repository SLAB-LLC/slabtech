import { createClient } from '@/utils/supabase/server'
import { createClient as createTokenClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/utils/rateLimit'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const FETCH_TIMEOUT_MS = 30_000

async function fetchWithTimeout(url: string, options: RequestInit, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function createAssemblyAITranscript(audioUrl: string, apiKey: string): Promise<string> {
  const response = await fetchWithTimeout(
    'https://api.assemblyai.com/v2/transcript',
    {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_models: ['universal-2'],
        speaker_labels: true,
        redact_pii: true,
        redact_pii_sub: 'entity_name',
        redact_pii_policies: [
          'credit_card_number',
          'credit_card_cvv',
          'credit_card_expiration',
          'phone_number',
          'us_social_security_number',
          'banking_information',
          'email_address',
          'location',
        ],
        // NOTE: redact_pii_audio is intentionally NOT set. AssemblyAI's audio
        // redaction is a separate job that runs after the transcript and
        // takes 30-60+ minutes for 3-hour files, blocking the entire pipeline.
        // Audio redaction can be added later as a separate background phase.
      }),
    },
    30_000,
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`AssemblyAI transcript creation failed: ${err}`)
  }

  const { id } = await response.json()
  return id
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filePath, originalFilename, salespersonId, metadata } = body

    if (!filePath)        return NextResponse.json({ error: 'File path is required' },     { status: 400 })
    if (!originalFilename) return NextResponse.json({ error: 'Original filename is required' }, { status: 400 })
    if (!salespersonId)   return NextResponse.json({ error: 'Salesperson is required' },   { status: 400 })

    const assemblyaiKey = process.env.ASSEMBLYAI_API_KEY
    if (!assemblyaiKey) {
      return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 })
    }

    const supabase = await createClient()

    // Auth — prefer explicit Bearer token (stays fresh across long uploads)
    const authHeader = request.headers.get('Authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const { data: { user } } = bearerToken
      ? await supabase.auth.getUser(bearerToken)
      : await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Role + rate limiting
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id')
      .eq('id', user.id)
      .single()

    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

    if (!isAdmin) {
      const rl = checkRateLimit(user.id, 10, 60 * 60 * 1000)
      if (!rl.allowed) {
        const mins = Math.ceil(rl.retryAfter! / 60)
        return NextResponse.json(
          { error: `Upload limit reached. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`, retryAfter: rl.retryAfter },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfter!), 'X-RateLimit-Remaining': String(rl.remaining) } },
        )
      }
    }

    // Validate file exists and create a long-lived signed URL for AssemblyAI
    // Signed as the uploader: storage only lets people link files they uploaded themselves
    // (sql/security-hardening-2026-11.sql), so nobody can feed in someone else's recording.
    const storageClient = bearerToken
      ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          global: { headers: { Authorization: `Bearer ${bearerToken}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : supabase
    const { data: signedUrlData, error: signedUrlError } = await storageClient.storage
      .from('call-recordings')
      .createSignedUrl(filePath, 86400) // 24 hours — gives AssemblyAI plenty of time

    if (signedUrlError || !signedUrlData) {
      console.error('Signed URL error:', signedUrlError)
      return NextResponse.json({ error: 'Failed to generate signed URL for file' }, { status: 500 })
    }

    // Submit to AssemblyAI — returns immediately with a job ID
    const assemblyaiTranscriptId = await createAssemblyAITranscript(signedUrlData.signedUrl, assemblyaiKey)
    console.log(`AssemblyAI job created: ${assemblyaiTranscriptId}`)

    // Look up salesperson name and uploader company now while we have context
    const { data: salespersonData } = await supabase
      .from('salespeople')
      .select('name')
      .eq('id', salespersonId)
      .single()

    const salespersonName = salespersonData?.name || 'Unknown'

    // Save a pending transcript record
    const { data: transcriptRecord, error: insertError } = await supabase
      .from('transcripts')
      .insert({
        salesperson_id: salespersonId,
        salesperson_name: salespersonName,
        original_filename: originalFilename,
        file_storage_path: filePath,
        redaction_config_used: 'assemblyai+claude',
        uploaded_by: user.id,
        company_id: profile?.company_id,
        status: 'processing',
        assemblyai_transcript_id: assemblyaiTranscriptId,
        processing_started_at: new Date().toISOString(),
        actual_sales_count: metadata?.actualSalesCount,
        expected_customer_count: metadata?.expectedCustomerCount,
        area_type: metadata?.areaType,
        estimated_duration_hours: metadata?.estimatedDurationHours,
        upload_notes: metadata?.uploadNotes,
        recording_type: metadata?.recordingType || 'continuous',
        manual_timestamps: metadata?.recordingType === 'manual_timestamps' && metadata?.manualTimestamps?.length
          ? metadata.manualTimestamps
          : null,
        recording_date: metadata?.recordingDate || null,
        redact_timestamps: metadata?.redactTimestamps?.length ? metadata.redactTimestamps : null,
      })
      .select('id')
      .single()

    if (insertError || !transcriptRecord) {
      console.error('DB insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save transcript record' }, { status: 500 })
    }

    console.log(`Transcript record created: ${transcriptRecord.id} (pending AssemblyAI job ${assemblyaiTranscriptId})`)

    return NextResponse.json({
      transcriptId: transcriptRecord.id,
      status: 'processing',
      message: 'Transcription job submitted. Poll /api/transcripts/:id/status for updates.',
    })
  } catch (error: any) {
    console.error('process-audio error:', error)
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
