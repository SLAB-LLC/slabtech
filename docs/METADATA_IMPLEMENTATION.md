# Upload Metadata Implementation

## Overview
Added metadata fields to the audio upload form to improve AI analysis accuracy and provide better context for long (8+ hour) recordings.

## What Was Added

### 1. Metadata Fields in Upload Form
The upload form now includes these optional fields:

- **Actual Sales Count** - How many sales the rep actually made
  - Helps calibrate AI detection (when AI says 10 but actual was 7)
  - Integer input

- **Customers Talked To** - Number of doors/customers the rep interacted with
  - Provides context for conversion rate
  - Integer input

- **Area Type** - Type of area where the rep was working
  - Options: City, Suburb, Boonies, Townhomes, Lake Homes, Rural, Mixed
  - Different areas have different conversation patterns

- **Recording Duration (hours)** - How long the recording is
  - Helps identify 8-hour recordings that need special handling
  - Decimal input (e.g., 8, 4.5)

- **Additional Notes** - Free-form context
  - Rep can add notes like "Team event day", "Lots of callbacks", "New neighborhood"
  - Text area for any additional context

### 2. Database Changes
New columns added to `transcripts` table:
- `actual_sales_count` (INTEGER)
- `expected_customer_count` (INTEGER)
- `area_type` (TEXT with constraint)
- `estimated_duration_hours` (DECIMAL)
- `upload_notes` (TEXT)

### 3. AI Analysis Integration
The metadata is now passed to Claude during conversation analysis to provide context:
- Helps Claude understand the recording better
- Calibrates expectations (e.g., "rep reported 7 sales, find those conversations")
- Adjusts for area type (suburban vs boonies have different patterns)
- Uses rep notes to understand context

## How to Deploy

### Step 1: Run Database Migration
```bash
# In Supabase SQL Editor, run:
upload-metadata-migration.sql
```

This will add the new columns to your `transcripts` table.

### Step 2: Deploy Code Changes
The following files were updated:
- ✅ `src/app/(user)/user/dashboard/page.tsx` - Upload form UI
- ✅ `src/hooks/useAudioUpload.ts` - Upload hook with metadata
- ✅ `src/app/api/process-audio/route.ts` - API endpoint to save metadata
- ✅ `src/utils/conversationAnalysis.ts` - AI analysis with metadata context

Just deploy your Next.js app as normal:
```bash
npm run build
# Then deploy to your hosting (Vercel, etc.)
```

## How It Works

### User Flow
1. Rep uploads an 8-hour audio file
2. Rep fills in metadata:
   - "I got 7 sales"
   - "Talked to about 50 customers"
   - "Working in Suburbs"
   - "Recording is 8 hours long"
   - Notes: "Hot day, lots of not-home callbacks"

3. System processes the audio
4. AI analysis receives context:
   ```
   RECORDING CONTEXT (from rep):
   The rep reported making 7 sale(s) during this recording
   The rep talked to approximately 50 customers
   This was in a suburban area
   Recording is approximately 8 hours long
   Rep notes: "Hot day, lots of not-home callbacks"
   ```

5. Claude uses this context to:
   - Better identify which conversations were likely sales
   - Understand there should be ~50 conversations total
   - Adjust expectations for suburban door-to-door patterns
   - Factor in the callback context

### Benefits
- **More accurate sale detection** - AI knows to find 7 sales, not guess
- **Better segmentation** - Knowing it's 8 hours helps with chunking
- **Context-aware analysis** - Area type and notes help Claude understand patterns
- **Quality control** - Can compare AI detected sales vs actual count

## Testing

### Test Scenario 1: Basic Metadata
1. Go to user dashboard → Upload tab
2. Select a salesperson
3. Upload an audio file
4. Fill in metadata:
   - Sales: 5
   - Customers: 40
   - Area: Suburb
   - Duration: 6
5. Submit
6. Check Supabase to verify metadata was saved

### Test Scenario 2: Long Audio (8+ hours)
1. Upload an 8-hour recording
2. Fill in all metadata fields including detailed notes
3. Verify AI analysis includes context in prompts
4. Compare AI-detected sales count vs actual

### Test Scenario 3: Minimal Metadata
1. Upload without filling any metadata fields
2. Should work normally (all fields are optional)
3. AI analysis runs without context

## Future Enhancements

Based on metadata, we can add:
1. **Adaptive segmentation** - Use different conversation gap detection for 8-hour files
2. **Quality metrics** - Show "AI found 10 sales, rep reported 7" for review
3. **Area-specific training** - "This area type has X% objection rate"
4. **Manual timestamps** - Let rep mark "Sale at 2:15:00" for very long files
5. **Analytics dashboard** - Show accuracy trends, area performance, etc.

## Troubleshooting

### Issue: Metadata not saving
- Check that migration was run successfully
- Verify column names match (snake_case in DB, camelCase in code)
- Check browser console for errors

### Issue: AI not using metadata
- Verify metadata is being passed to `/api/process-audio`
- Check server logs to see if metadata is reaching `analyzeConversation`
- Confirm ANTHROPIC_API_KEY is set

### Issue: Form validation errors
- All metadata fields are optional
- Numbers should be positive
- Area type dropdown only allows predefined values

## Notes
- All metadata fields are **optional** - reps can skip them if in a hurry
- Metadata is stored with each transcript for future reference
- You can add more fields later using the same pattern
- Consider making some fields required after testing shows they're valuable
