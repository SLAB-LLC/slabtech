# Streak Feature Documentation

## Overview
The streak system tracks consecutive days users engage with audio content, displaying an animated fire emblem in the header that changes color every week.

## Setup

### 1. Database Migration
Run the migration to create the necessary tables:

```bash
# In your Supabase SQL Editor, run:
user-streaks-migration.sql
```

This creates:
- `user_streaks` - Stores current and longest streak data
- `streak_activities` - Logs daily activities
- Auto-updating trigger function

### 2. Components

**StreakCounter Component** (`src/components/StreakCounter.tsx`)
- Displays animated fire emblem with streak number
- Changes color every 7 days (week):
  - Week 1: Red Fire 🔴
  - Week 2: Orange Fire 🟠
  - Week 3: Blue Fire 🔵
  - Week 4: Purple Fire 🟣
  - Week 5: Gold Fire 🟡
  - Week 6: Green Fire 🟢
  - (Cycles back to red after week 6)

**Header Integration** (`src/components/layout/Header.tsx`)
- Automatically fetches and displays streak for authenticated users
- Centered in the header
- Only visible when logged in

## API Endpoints

### GET /api/streak
Fetches current user's streak data.

**Response:**
```json
{
  "current_streak": 5,
  "longest_streak": 12,
  "total_activities": 45,
  "last_activity_date": "2025-12-20"
}
```

### POST /api/streak
Logs a new activity (call when user listens to audio).

**Request:**
```json
{
  "transcript_id": "uuid-here", // optional
  "activity_type": "audio_listen" // optional, defaults to 'audio_listen'
}
```

**Response:**
```json
{
  "success": true,
  "streak": { /* updated streak data */ },
  "activity": { /* activity record */ }
}
```

## Usage

### Logging Activities

Add this code wherever users listen to audio (e.g., in an audio player component):

```typescript
// When user plays audio
const logActivity = async (transcriptId: string) => {
  try {
    const response = await fetch('/api/streak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript_id: transcriptId }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Streak updated:', data.streak.current_streak);
      // Optionally refresh the header to show new streak
    }
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};
```

### Example Integration

In your audio player component:
```typescript
'use client';

import { useEffect } from 'react';

export function AudioPlayer({ transcriptId }: { transcriptId: string }) {
  const handlePlay = async () => {
    // Log activity when user plays audio
    await fetch('/api/streak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript_id: transcriptId }),
    });
  };

  return (
    <audio
      onPlay={handlePlay}
      controls
      src="/path/to/audio.mp3"
    />
  );
}
```

## Features

✅ Automatic streak calculation
✅ Color-changing fire based on week number
✅ Smooth animations (flicker, pulse, floating particles)
✅ Thermal camera aesthetic integration
✅ Hover tooltip showing week and color name
✅ Prevents duplicate activities per day
✅ Tracks longest streak ever achieved

## How It Works

1. User listens to audio → POST request to `/api/streak`
2. System checks if activity already logged today
3. If new day, `streak_activities` record is created
4. Database trigger automatically:
   - Increments streak if consecutive day
   - Resets to 1 if gap in days
   - Updates longest streak if current > previous best
5. Header fetches updated streak on mount
6. Fire emblem displays with week-appropriate color

## Customization

### Change Week Colors
Edit `getFireColorByWeek()` in `StreakCounter.tsx`:
```typescript
const colorSchemes = [
  { color: '#ff0844', ... }, // Week 1
  { color: '#ff5733', ... }, // Week 2
  // Add more colors as needed
];
```

### Adjust Activity Type
Modify the POST request body to track different activities:
```typescript
{ activity_type: 'video_watch' } // or 'lesson_complete', etc.
```
