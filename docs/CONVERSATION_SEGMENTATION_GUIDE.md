# Conversation Segmentation Guide

## Current Parameters

The conversation segmentation happens in `src/utils/conversationSegmentation.ts` using these key parameters:

```typescript
MIN_CONVERSATION_DURATION = 20 seconds  // Minimum length to count as a conversation
TIME_GAP_THRESHOLD = 3 seconds          // Short pause within same conversation
LARGE_GAP_THRESHOLD = 30 seconds        // Long pause = definitely new conversation
```

## How Segmentation Works

### Algorithm Overview (Hybrid Approach)
The system uses a **hybrid** approach that combines:
1. **Speaker-based detection** (primary method)
2. **Silence-based detection** (fallback)

### Speaker-Based Segmentation Logic

A **new conversation** starts when:
1. **Large gap (30+ seconds)** between words
   - Assumes rep is walking between doors
   - Creates new conversation regardless of speaker

2. **Small gap (3-30 seconds) + New customer speaker**
   - If there's a 3-30 second pause AND the speaker is someone new (not the rep, not a previous customer at this door)
   - Allows multiple customers at the same door (spouse joining)

### Filtering Rules

Conversations are **excluded** if:
- Duration < 20 seconds (filters door slams, "no soliciting", errors)
- Only 1 speaker (filters rep talking to themselves while walking)

## Why It Might Miss Sales

### Common Issues:
1. **30-second threshold too short for long recordings**
   - In 8-hour recordings, reps might spend 30-60 seconds between doors
   - Current threshold treats 31+ second gaps as new conversations
   - Solution: Make threshold adaptive based on recording length

2. **Short sales conversations (< 20 seconds)**
   - Quick sales/callbacks might be under 20 seconds
   - These get filtered out
   - Solution: Lower threshold for recordings with high sales density

3. **Same-speaker sales**
   - If AssemblyAI incorrectly labels multiple customers as the same speaker
   - System thinks it's one long conversation
   - Solution: Use larger silence gaps to split even without speaker change

## Adaptive Segmentation (Recommended)

Based on your metadata, we can adjust parameters:

```typescript
// For 8+ hour recordings
if (estimatedDurationHours >= 8) {
  LARGE_GAP_THRESHOLD = 60 seconds        // More conservative
  MIN_CONVERSATION_DURATION = 15 seconds  // Catch shorter interactions
}

// For high-density sales days
const salesDensity = actualSalesCount / expectedCustomerCount
if (salesDensity > 0.15) { // 15%+ conversion rate
  MIN_CONVERSATION_DURATION = 15 seconds  // Don't filter short sales
}

// For rural/boonies areas (longer walks between doors)
if (areaType === 'boonies' || areaType === 'rural') {
  LARGE_GAP_THRESHOLD = 120 seconds       // Even longer threshold
}
```

## Quick Tuning Guide

### If Missing Sales:
1. **Lower MIN_CONVERSATION_DURATION** (try 15 or 10 seconds)
   - Catches quick sales/callbacks
   - Risk: More noise/false positives

2. **Increase LARGE_GAP_THRESHOLD** (try 60 or 90 seconds)
   - Less aggressive splitting
   - Risk: Multiple customers merged into one conversation

### If Getting Too Many False Conversations:
1. **Increase MIN_CONVERSATION_DURATION** (try 30 seconds)
   - Filters more noise
   - Risk: Might miss quick sales

2. **Decrease LARGE_GAP_THRESHOLD** (try 20 seconds)
   - More aggressive splitting
   - Risk: Might split single conversations

## Testing Recommendations

1. **Upload a known recording** with metadata:
   - "8 hours, 7 sales, 50 customers, suburb"

2. **Check conversation count**:
   - Should be around 50 conversations
   - If much lower: threshold too high, conversations being merged
   - If much higher: threshold too low, splitting too aggressively

3. **Compare AI sales vs actual**:
   - AI found 10, actual was 7?
   - Check if AI is counting pitch conversations as sales
   - Adjust categorization threshold (PII redaction count)

## Manual Override Option

For very long or problematic recordings, consider:
1. **Chapter markers** - Let reps manually mark "Sale at 2:15:00"
2. **Time-based chunking** - Pre-split 8-hour files into hourly chunks
3. **Manual review mode** - Flag low-confidence sales for human verification

## Current Implementation Location

To modify these parameters:
- **File**: `src/utils/conversationSegmentation.ts`
- **Function**: `segmentConversations()` (lines 41-135)
- **Parameters**: Lines 49-52

## Next Steps

Want me to:
1. ✅ Make segmentation adaptive based on metadata?
2. ✅ Add a "Manual Corrections" feature for fixing AI counts?
3. ✅ Show "AI vs Actual" comparison on transcript details page?
