import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { runFullPiiDetection } from '@/utils/piiDetectionPasses'
import type { WordEntry, AssemblyAIEntity } from '@/utils/piiDetectionPasses'
import { processAudioInChunks, mergeRanges } from '@/utils/ffmpegRedaction'
import {
  segmentConversationsHybrid,
  getConversationText,
  countPiiInConversation,
  findTextTimestamp,
  filterRedactedWords,
} from '@/utils/conversationSegmentation'
import { analyzeConversation } from '@/utils/conversationAnalysis'
import type { UploadMetadata } from '@/utils/conversationAnalysis'
import type { PiiMatch } from '@/utils/pii'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

type AssemblyAITranscript = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error' | 'terminated'
  text: string
  words: Array<{ text: string; start: number; end: number; confidence: number; speaker?: string }>
  entities?: AssemblyAIEntity[]
  redacted_audio?: { status: string; redacted_audio_url: string }
  error?: string
}

// Long enough that a slow pipeline (saving a large transcript JSONB +
// segmenting many conversations) can't be interrupted by a recovery poll.
// Only Vercel-killed (~5 min) jobs really need recovery.
const FINALIZING_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

async function fetchWithTimeout(url: string, options: RequestInit, ms = 30_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Main GET handler ─────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth — prefer Bearer token for the same reason as process-audio
    const authHeader = request.headers.get('Authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const { data: { user } } = bearerToken
      ? await supabase.auth.getUser(bearerToken)
      : await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: transcript, error: fetchError } = await supabase
      .from('transcripts')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // ── Fast-path: already done ──────────────────────────────────────────────

    if (transcript.status === 'completed') {
      return NextResponse.json({
        status: 'completed',
        transcriptId: transcript.id,
        piiMatchCount: transcript.transcript_redacted?.pii_matches?.length ?? 0,
        message: 'Processing complete',
      })
    }

    if (transcript.status === 'error') {
      return NextResponse.json({ status: 'error', error: transcript.processing_error || 'Processing failed' })
    }

    // ── 'finalizing' guard: detect stuck jobs and allow retry ────────────────

    if (transcript.status === 'finalizing') {
      const startedAt = transcript.processing_started_at
        ? new Date(transcript.processing_started_at).getTime()
        : Date.now()

      if (Date.now() - startedAt > FINALIZING_TIMEOUT_MS) {
        // Previous attempt timed out — reset so the next poll retries
        const sr = createServiceRoleClient()
        await sr
          .from('transcripts')
          .update({ status: 'processing' })
          .eq('id', id)
        console.warn(`Transcript ${id} was stuck in 'finalizing' — reset to 'processing'`)
        return NextResponse.json({ status: 'processing', message: 'Retrying after timeout...' })
      }

      return NextResponse.json({ status: 'processing', message: 'Applying PII redaction...' })
    }

    // ── Check AssemblyAI ─────────────────────────────────────────────────────

    if (!transcript.assemblyai_transcript_id) {
      return NextResponse.json({ status: 'error', error: 'No AssemblyAI job ID on this transcript' })
    }

    const assemblyaiKey = process.env.ASSEMBLYAI_API_KEY
    if (!assemblyaiKey) {
      return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 })
    }

    const aaiResp = await fetchWithTimeout(
      `https://api.assemblyai.com/v2/transcript/${transcript.assemblyai_transcript_id}`,
      { headers: { authorization: assemblyaiKey } },
    )

    if (!aaiResp.ok) {
      return NextResponse.json({ status: 'processing', message: 'Checking transcription status...' })
    }

    const aaiTranscript: AssemblyAITranscript = await aaiResp.json()

    if (aaiTranscript.status === 'queued' || aaiTranscript.status === 'processing') {
      return NextResponse.json({
        status: 'processing',
        phase: 'transcribing',
        assemblyaiStatus: aaiTranscript.status,
        message: `Transcribing audio (AssemblyAI: ${aaiTranscript.status})`,
      })
    }

    // Use the service-role client for state mutations on the transcript so
    // RLS policies can never silently filter out our UPDATE. We've seen this
    // exact failure mode: SELECT works (user sees their transcript) but
    // UPDATE matches 0 rows because the policy on UPDATE is more restrictive,
    // returning PGRST116 and looking like 'no rows matched the WHERE clause'.
    const sr = createServiceRoleClient()

    if (aaiTranscript.status === 'error' || aaiTranscript.status === 'terminated') {
      const msg = aaiTranscript.error || 'AssemblyAI transcription failed'
      await sr
        .from('transcripts')
        .update({ status: 'error', processing_error: msg, processing_completed_at: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ status: 'error', error: msg })
    }

    // ── AssemblyAI is done — claim the work atomically ────────────────────────

    console.log(`[lock] attempting for ${id} (current DB status: ${transcript.status}, AAI status: ${aaiTranscript.status})`)
    const { data: locked, error: lockError } = await sr
      .from('transcripts')
      .update({ status: 'finalizing', processing_started_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'processing') // Only one caller wins this race
      .select('id')
      .single()

    if (lockError) {
      const isNoRows = lockError.code === 'PGRST116'
      if (!isNoRows) {
        // Real error — most likely the 'finalizing' status check constraint hasn't been applied
        console.error(`[lock] error for ${id}: code=${lockError.code} message=${lockError.message}`)
        const isConstraintError = lockError.message?.includes('check constraint') ||
                                  lockError.message?.includes('violates')
        const userMessage = isConstraintError
          ? "Database migration not applied. Run sql/async-processing-v2-migration.sql in your Supabase SQL editor."
          : `Failed to start processing: ${lockError.message}`
        await sr
          .from('transcripts')
          .update({ status: 'error', processing_error: userMessage, processing_completed_at: new Date().toISOString() })
          .eq('id', id)
        return NextResponse.json({ status: 'error', error: userMessage })
      }
      console.warn(`[lock] no rows matched (PGRST116) — another invocation likely got the lock first`)
    }

    if (!locked) {
      // Another request already claimed it
      return NextResponse.json({ status: 'processing', message: 'Applying PII redaction...' })
    }

    console.log(`[lock] acquired for ${id}`)

    // ── Full processing pipeline ──────────────────────────────────────────────

    try {
      const piiMatchCount = await runProcessingPipeline(
        id,
        transcript,
        aaiTranscript,
        sr, // pass service-role client for all subsequent writes
      )

      return NextResponse.json({
        status: 'completed',
        transcriptId: id,
        piiMatchCount,
        message: 'Processing complete',
      })
    } catch (pipelineErr: any) {
      console.error(`Processing pipeline failed for ${id}:`, pipelineErr)
      await sr
        .from('transcripts')
        .update({
          status: 'error',
          processing_error: pipelineErr.message || 'Processing failed',
          processing_completed_at: new Date().toISOString(),
        })
        .eq('id', id)
      return NextResponse.json({ status: 'error', error: pipelineErr.message || 'Processing failed' })
    }
  } catch (error: any) {
    console.error('Status route error:', error)
    return NextResponse.json({ error: error.message || 'Failed to check status' }, { status: 500 })
  }
}

// ─── Processing pipeline (runs once per transcript) ───────────────────────────

async function runProcessingPipeline(
  transcriptId: string,
  dbRecord: any,
  aaiTranscript: AssemblyAITranscript,
  supabase: any,
): Promise<number> {
  const tStart = Date.now()
  console.log(`[pipeline] >>> START transcript ${transcriptId}`)

  // 1. Convert words to seconds
  let words: WordEntry[] = aaiTranscript.words.map(w => ({
    word: w.text,
    start: w.start / 1000,
    end: w.end / 1000,
    speaker: w.speaker,
  }))

  // 1b. Drop words inside rep-flagged "redact timestamps" (sensitive/non-sales
  // calls) before anything else sees them — keeps them out of PII detection,
  // segmentation, and the stored transcript text.
  const redactTimestamps: Array<{ start: number; end: number }> = dbRecord.redact_timestamps ?? []
  if (redactTimestamps.length) {
    const before = words.length
    words = filterRedactedWords(words, redactTimestamps)
    console.log(`[pipeline] redact_timestamps: dropped ${before - words.length} words across ${redactTimestamps.length} range(s)`)
  }

  const totalDuration = words.length > 0 ? words[words.length - 1].end : 0
  console.log(`[pipeline] words: ${words.length}, duration: ${totalDuration.toFixed(0)}s, conversations to expect: roughly ${Math.ceil(totalDuration / 60)}+`)
  console.log(`[pipeline] transcript text length: ${aaiTranscript.text?.length ?? 0} chars`)

  // Rebuild transcript text from the (possibly filtered) words so that
  // anything dropped by redact_timestamps doesn't linger in the stored text.
  const transcriptText = redactTimestamps.length
    ? words.map(w => w.word).join(' ')
    : aaiTranscript.text

  // 2. PII detection. Pass 5 (Claude secondary) is intentionally skipped
  //    here — the prompt is the FULL transcript text, which for 3-hour
  //    recordings runs 100K+ tokens. Combined with the SDK's built-in retries
  //    that single call can stall the entire pipeline past Vercel's 5-min
  //    limit, leaving the DB stuck in 'finalizing'. Passes 1a/1b (AssemblyAI
  //    entities + word labels), regex, number sequences, and spelled-out
  //    cover the dominant cases. Re-enable Claude once the call is chunked.
  const piiStart = Date.now()
  const piiMatches = await runFullPiiDetection(
    transcriptText,
    words,
    aaiTranscript.entities,
    undefined, // skip Claude pass 5 for now
  )
  console.log(`[pipeline] PII detection: ${piiMatches.length} ranges in ${((Date.now() - piiStart) / 1000).toFixed(1)}s`)

  // 2b. Merge rep-flagged redact_timestamps into the muted ranges so the
  // separate /redact-audio pass silences these segments along with PII.
  const allMutedRanges = redactTimestamps.length
    ? mergeRanges([...piiMatches, ...redactTimestamps.map(r => ({ ...r, label: 'redacted_segment' }))])
    : piiMatches

  // 3. Audio redaction is intentionally skipped for now — it pushes the total
  //    pipeline time over Vercel's 5-min serverless limit. The transcript
  //    text still has full PII redaction (5 passes including Claude). Audio
  //    file points to the original; the player handles redaction visually
  //    using the pii_matches we save below. Server-side audio redaction can
  //    be added back later as a separate background phase.
  const filePath = dbRecord.file_storage_path as string
  const redactedFilePath = '' // empty → player falls back to file_storage_path

  // 5. Save transcript data to DB
  const dbStart = Date.now()
  const { error: updateError } = await supabase
    .from('transcripts')
    .update({
      transcript_redacted: {
        text: transcriptText,
        words,
        pii_matches: allMutedRanges,
        redacted_file_storage_path: redactedFilePath,
      },
      status: 'completed',
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', transcriptId)

  if (updateError) {
    throw new Error(`Failed to update transcript DB record: ${updateError.message}`)
  }
  console.log(`[pipeline] transcript saved in ${((Date.now() - dbStart) / 1000).toFixed(1)}s, status=completed`)

  // 6. Conversation segmentation + analysis. Claude per-conversation
  //    objection detection runs here with hard timeouts (20s/call, 1 retry).
  //    Wrapped in try/catch so a slow Claude can't take down the whole
  //    pipeline — transcript is already saved as 'completed' above.
  try {
    const convStart = Date.now()
    await processConversations(transcriptId, dbRecord, words, piiMatches, supabase)
    console.log(`[pipeline] conversations done in ${((Date.now() - convStart) / 1000).toFixed(1)}s`)
  } catch (convErr) {
    console.error('[pipeline] Conversation processing error (non-fatal):', convErr)
  }

  console.log(`[pipeline] <<< COMPLETE in ${((Date.now() - tStart) / 1000).toFixed(1)}s`)
  return piiMatches.length
}

// ─── Audio redaction with FFmpeg + AssemblyAI fallback ───────────────────────

async function produceRedactedAudio(args: {
  transcriptId: string
  sourcePath: string
  destPath: string
  piiMatches: PiiMatch[]
  totalDuration: number
  aaiTranscript: AssemblyAITranscript
  supabase: any
}): Promise<void> {
  const { sourcePath, destPath, piiMatches, totalDuration, aaiTranscript, supabase } = args

  const aaiUrl = aaiTranscript.redacted_audio?.redacted_audio_url
  const aaiReady = aaiTranscript.redacted_audio?.status === 'completed'

  // PRIMARY: use AssemblyAI's pre-redacted audio. No FFmpeg, no chunking —
  // just stream-download to a buffer and upload to Supabase. Total ~30-60s
  // for a 169MB file, well within Vercel's 5-min limit.
  // The audio gets passes 1a/1b PII coverage (AssemblyAI's ML detection).
  // Transcript text still gets all 5 passes including Claude.
  if (aaiUrl && aaiReady) {
    console.log('[audio] using AssemblyAI redacted audio (skipping FFmpeg)')
    const t0 = Date.now()
    const aaiResp = await fetch(aaiUrl)
    if (!aaiResp.ok) {
      // AssemblyAI's URL failed — fall through to FFmpeg
      console.warn(`[audio] AssemblyAI URL fetch failed (${aaiResp.status}), falling back to FFmpeg`)
    } else {
      const buffer = Buffer.from(await aaiResp.arrayBuffer())
      console.log(`[audio] AssemblyAI download: ${(buffer.length / 1024 / 1024).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

      const upStart = Date.now()
      const { error: uploadError } = await supabase.storage
        .from('call-recordings')
        .upload(destPath, buffer, { contentType: 'audio/mpeg', upsert: true })
      if (uploadError) {
        throw new Error(`Failed to upload redacted audio: ${uploadError.message}`)
      }
      console.log(`[audio] uploaded to ${destPath} in ${((Date.now() - upStart) / 1000).toFixed(1)}s`)
      return
    }
  }

  // FALLBACK: AssemblyAI didn't produce redacted audio (older transcripts
  // submitted before redact_pii_audio: true was added, or AssemblyAI URL
  // failed). Run our own chunked FFmpeg as a backup.
  console.log('[audio] AssemblyAI redacted audio unavailable — using chunked FFmpeg')
  await runFfmpegFallback({ sourcePath, destPath, piiMatches, totalDuration, supabase })
}

async function runFfmpegFallback(args: {
  sourcePath: string
  destPath: string
  piiMatches: PiiMatch[]
  totalDuration: number
  supabase: any
}): Promise<void> {
  const { sourcePath, destPath, piiMatches, totalDuration, supabase } = args

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('call-recordings')
    .createSignedUrl(sourcePath, 3600)

  if (signedUrlError || !signedUrlData) {
    throw new Error('Failed to generate signed URL for audio download')
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slab-redact-'))
  try {
    const inputPath  = path.join(tmpDir, 'input.mp3')
    const outputPath = path.join(tmpDir, 'redacted.mp3')

    const dlStart = Date.now()
    const audioResp = await fetch(signedUrlData.signedUrl)
    if (!audioResp.ok || !audioResp.body) {
      throw new Error(`Failed to download audio: HTTP ${audioResp.status}`)
    }
    await pipeline(Readable.fromWeb(audioResp.body as any), createWriteStream(inputPath))
    const inputStat = await fs.stat(inputPath)
    console.log(`[audio] downloaded ${(inputStat.size / 1024 / 1024).toFixed(1)}MB in ${((Date.now() - dlStart) / 1000).toFixed(1)}s`)

    const ffStart = Date.now()
    await processAudioInChunks(inputPath, outputPath, piiMatches, totalDuration)
    console.log(`[audio] FFmpeg done in ${((Date.now() - ffStart) / 1000).toFixed(1)}s`)

    const upStart = Date.now()
    const redactedBuffer = await fs.readFile(outputPath)
    console.log(`[audio] redacted size: ${(redactedBuffer.length / 1024 / 1024).toFixed(1)}MB`)

    const { error: uploadError } = await supabase.storage
      .from('call-recordings')
      .upload(destPath, redactedBuffer, { contentType: 'audio/mpeg', upsert: true })

    if (uploadError) {
      throw new Error(`Failed to upload redacted audio: ${uploadError.message}`)
    }
    console.log(`[audio] uploaded to ${destPath} in ${((Date.now() - upStart) / 1000).toFixed(1)}s`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── Conversation analysis ────────────────────────────────────────────────────

async function processConversations(
  transcriptId: string,
  dbRecord: any,
  words: WordEntry[],
  piiMatches: PiiMatch[],
  supabase: any,
) {
  const recordingType: 'continuous' | 'edited_clips' | 'manual_timestamps' =
    dbRecord.recording_type === 'edited_clips' ? 'edited_clips'
    : dbRecord.recording_type === 'manual_timestamps' ? 'manual_timestamps'
    : 'continuous'

  const conversations = segmentConversationsHybrid(words, 'A', 30, {
    recordingType,
    expectedCustomerCount: dbRecord.expected_customer_count ?? undefined,
    actualSalesCount: dbRecord.actual_sales_count ?? undefined,
    manualTimestamps: dbRecord.manual_timestamps ?? undefined,
  })
  console.log(`[conversations] segmented ${conversations.length} conversations (recordingType=${recordingType})`)
  if (!conversations.length) return

  // Claude objection detection per conversation. Each call has a hard 20s
  // timeout + 1 retry (set in conversationAnalysis.ts), so even 100+
  // conversations can't stall the pipeline past ~5 min worst case. Within
  // the 15-min auto-recovery window with margin to spare.
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  const metadata: UploadMetadata = {
    actualSalesCount:      dbRecord.actual_sales_count      ?? undefined,
    expectedCustomerCount: dbRecord.expected_customer_count ?? undefined,
    areaType:              dbRecord.area_type               ?? undefined,
    estimatedDurationHours:dbRecord.estimated_duration_hours?? undefined,
    uploadNotes:           dbRecord.upload_notes            ?? undefined,
  }

  // Analyse all conversations in parallel batches (5 concurrent Claude calls)
  const BATCH = 5
  const analysed: Array<{ conversation: any; analysis: any; piiCount: number }> = []

  for (let i = 0; i < conversations.length; i += BATCH) {
    const batch = conversations.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(async (conv) => {
        const text     = getConversationText(conv)
        const piiCount = countPiiInConversation(piiMatches, conv)
        const analysis = await analyzeConversation(text, piiCount, anthropicKey, metadata)
        return { conversation: conv, analysis, piiCount }
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled') analysed.push(r.value)
      else console.error('Conversation analysis failed:', r.reason)
    }
  }

  // Sales calibration: apply actualSalesCount override
  let finalAnalysed = analysed
  if (metadata.actualSalesCount !== undefined && metadata.actualSalesCount > 0) {
    console.log(`Calibrating to ${metadata.actualSalesCount} reported sales`)

    const priceConvs = analysed
      .filter(c => c.analysis.hasPriceMention)
      .sort((a, b) => b.piiCount - a.piiCount)

    let salesPool = [...priceConvs]
    if (salesPool.length < metadata.actualSalesCount) {
      const piiOnly = analysed
        .filter(c => c.piiCount > 0 && !c.analysis.hasPriceMention)
        .sort((a, b) => b.piiCount - a.piiCount)
      salesPool = [...salesPool, ...piiOnly]
    }
    if (salesPool.length < metadata.actualSalesCount) {
      const remaining = analysed
        .filter(c => !salesPool.includes(c))
        .sort((a, b) => b.conversation.durationSeconds - a.conversation.durationSeconds)
      salesPool = [...salesPool, ...remaining]
    }

    const saleNumbers = new Set(
      salesPool.slice(0, metadata.actualSalesCount).map(c => c.conversation.conversationNumber),
    )

    finalAnalysed = analysed.map(item => {
      let category = item.analysis.category
      if (saleNumbers.has(item.conversation.conversationNumber)) category = 'sale'
      else if (item.analysis.hasPriceMention) category = 'pitch'
      else category = 'interaction'
      return { ...item, analysis: { ...item.analysis, category } }
    })
  }

  // Persist conversations
  for (const { conversation, analysis } of finalAnalysed) {
    if (conversation.wordCount < 10) continue

    const objectionTimestamps = analysis.objectionsWithText.map((obj: any) => ({
      type: obj.type,
      text: obj.text,
      timestamp: findTextTimestamp(obj.text, conversation.words) ?? conversation.startTime,
    }))

    await supabase.from('conversations').insert({
      transcript_id: transcriptId,
      conversation_number: conversation.conversationNumber,
      start_time: conversation.startTime,
      end_time: conversation.endTime,
      speakers: conversation.speakers,
      sales_rep_speaker: 'A',
      word_count: conversation.wordCount,
      duration_seconds: conversation.durationSeconds,
      category: analysis.category,
      objections: analysis.objections,
      objections_with_text: analysis.objectionsWithText,
      objection_timestamps: objectionTimestamps,
      has_price_mention: analysis.hasPriceMention,
      pii_redaction_count: analysis.piiRedactionCount,
      analysis_completed: analysis.analysisCompleted,
      analysis_error: analysis.analysisError,
    })
  }

  console.log(`Inserted ${finalAnalysed.filter(c => c.conversation.wordCount >= 10).length} conversations`)
}
