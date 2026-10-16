# Speech Detection / Non-Speech Removal - Implementation Notes

## Goal
Remove non-speech audio (like driving between houses) from large recordings to save on AssemblyAI transcription costs.

## What We Tried

### Attempt 1: VAD (Voice Activity Detection) Library
- **Library**: `@ricky0123/vad-node` (Silero VAD)
- **Why it failed**: Incompatible with Next.js API routes
  - Native bindings don't work with Next.js bundler (even with `serverExternalPackages`)
  - Dynamic imports and require() both failed
  - Error: `utils.audioFileToArray is not a function`
- **Conclusion**: VAD library won't work in Next.js environment

### Attempt 2: FFmpeg Silence Detection
- **Approach**: Use FFmpeg's `silencedetect` filter
- **Implementation**: `silencedetect=noise=-60dB:d=60`
- **Why it didn't work well**:
  - Parameters tuned for detecting actual silence, not background noise vs speech
  - Car engine noise, radio, brief sounds prevent detection
  - Threshold and duration are hard to tune for different recordings

**Test Results**:
- 121-minute audio: 0 silence periods detected
- Tried `-60dB` threshold with `60s` minimum duration
- Audio likely has continuous background noise (engine, radio, ambient sounds)

## Current Status

**Feature is DISABLED by default** (threshold set to trigger only on very large files).

To enable, add to `.env.local`:
```bash
SILENCE_THRESHOLD_DB=-70
MIN_SILENCE_DURATION=30
```

## Potential Future Solutions

### 1. Pre-process Audio Outside Next.js
- Use a separate Node.js script with VAD library
- Process files before uploading to the main app
- Pros: Full access to VAD library
- Cons: Extra step in workflow

### 2. More Advanced FFmpeg Analysis
- Use `astats` filter to analyze audio variation
- Detect periods with low RMS variation (engine noise) vs high variation (conversation)
- Might work better than silence detection
- Example: `astats=metadata=1:reset=1`

### 3. Machine Learning Approach
- Train a model to detect "driving" vs "conversation" audio
- Could use audio features: spectral centroid, zero-crossing rate, MFCC
- Requires training data and infrastructure

### 4. Manual Segmentation
- Provide UI for users to manually mark non-speech sections
- Time-consuming but accurate
- Could be done per salesperson/route over time

### 5. Time-based Heuristics
- If recordings are structured (e.g., houses are X minutes apart)
- Could use GPS data or timestamps to estimate driving periods
- Requires additional metadata

## Files Modified

- `src/app/api/process-audio/route.ts` - Speech detection integration
- `src/utils/audioSegmentation.ts` - VAD library wrapper (unused)
- `next.config.mjs` - External packages config
- `.env.example` - Parameter documentation

## Code Location

Speech detection code in `route.ts` (lines ~545-625):
- Checks file size (>100MB)
- Runs FFmpeg silence detection
- Concatenates speech segments
- Uploads trimmed audio to AssemblyAI

Can be safely left in place - won't trigger with default settings.

## Recommendations for Revisiting

1. **Analyze a sample recording**:
   - Run FFmpeg manually to see what silence patterns exist
   - `ffmpeg -i audio.mp3 -af silencedetect=noise=-60dB:d=30 -f null -`
   - Check if any silence periods are detected

2. **Get audio characteristics**:
   - What's typical background noise level during driving?
   - Is there music/radio playing?
   - How long are typical driving periods?

3. **Consider hybrid approach**:
   - Combination of silence detection + audio stats + metadata
   - Multiple passes with different parameters
   - User confirmation before trimming

4. **Test with clean audio**:
   - If possible, get a recording with clear driving periods
   - No radio/music during driving
   - This would help tune parameters

## Cost Analysis

For a 5-hour recording with 40% driving time:
- **Without trimming**: 300 min × $0.37/hour = $1.85
- **With trimming (40% removed)**: 180 min × $0.37/hour = $1.11
- **Savings**: $0.74 per file (40%)

Worth pursuing if processing many large files regularly.
