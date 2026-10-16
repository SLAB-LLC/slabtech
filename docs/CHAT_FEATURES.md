# Chat Features Guide

## 1. Archive/Delete Chats

Users can now manage their chats with a settings menu (three dots icon) in the chat header.

### Available Actions:

**For all channels (DMs and Groups):**
- **Archive** - Hide the conversation from the list (can be unarchived later)

**For Groups only:**
- **Leave Group** - Remove yourself from the group
- **Delete Group** - (Creators and Company Admins only) Permanently delete the group

### How it works:
- Click the ⋮ (three dots) icon in the chat header
- Select your desired action
- Confirm the action

## 2. Share Audio to Chat

You can share audio transcripts directly to any chat with a link and optional message.

### How to Add to Transcript Pages:

```tsx
import { ShareToChat } from '@/components'

// In your transcript page component:
<ShareToChat
  transcriptId={transcript.id}
  transcriptTitle={transcript.title} // Optional - shows in modal
  timestampStart={startTime} // Optional - specific segment
  timestampEnd={endTime}     // Optional - specific segment
/>
```

### Example Usage:

```tsx
// Simple share (entire transcript)
<ShareToChat transcriptId="abc-123" />

// Share with title
<ShareToChat
  transcriptId="abc-123"
  transcriptTitle="Sales Call with John Doe"
/>

// Share specific segment
<ShareToChat
  transcriptId="abc-123"
  transcriptTitle="Sales Call - Objection Handling"
  timestampStart={45.5}
  timestampEnd={120.0}
/>
```

### What Happens:
1. User clicks "Share to Chat" button
2. Modal opens showing all their chat channels
3. User selects a channel and adds a message
4. Message is posted to the chat with a clickable audio preview card
5. Recipients can click the card to jump directly to that transcript/timestamp

### Message Appearance:
When shared, the audio appears as a nice card in the chat:

```
🔊 Shared Audio Clip
   45s - 120s
   Tap to listen →
```

Clicking it navigates to: `/transcripts/{id}?t={timestamp}`

## Adding ShareToChat to Your Pages

Find your transcript detail page (usually something like `src/app/(admin)/transcripts/[id]/page.tsx` or `src/app/c/[slug]/transcripts/[id]/page.tsx`) and add:

```tsx
import { ShareToChat } from '@/components'

export default function TranscriptPage({ transcript }) {
  return (
    <div>
      {/* Your existing transcript UI */}

      {/* Add this button somewhere visible */}
      <div className="mb-4">
        <ShareToChat
          transcriptId={transcript.id}
          transcriptTitle={transcript.salesperson_name}
        />
      </div>

      {/* Rest of your transcript view */}
    </div>
  )
}
```

## API Endpoints Used

- `POST /api/chat/channels/{id}/archive` - Archive a channel
- `DELETE /api/chat/channels/{id}/members/{userId}` - Leave a group
- `DELETE /api/chat/channels/{id}` - Delete a group (admin only)
- `POST /api/chat/channels/{id}/messages` - Share transcript (with transcript_id, timestamp_start, timestamp_end)
