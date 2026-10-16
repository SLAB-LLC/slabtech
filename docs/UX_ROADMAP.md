# Slab Voice - UX Roadmap for Sales Training

## Context
Slab Voice is being developed as a door-to-door sales training platform where sales reps can learn from example calls and (eventually) their own recorded calls to improve their selling techniques.

## Target Users
- Door-to-door sales representatives
- Sales managers/coaches
- Self-paced learners and team-based training programs

---

## Priority 1: Foundation Features

### 1. Interactive Audio Player with Transcript Sync ⭐ MUST-HAVE
**Status**: In Development

**Features**:
- Click any word in transcript → jump to that moment in audio
- Highlight current word/sentence as audio plays
- Playback speed controls (0.75x, 1x, 1.25x, 1.5x, 2x)
- Skip forward/back buttons (10 seconds)
- Standard play/pause controls
- Progress bar with scrubbing capability
- Current time / total duration display

**Why it matters**: Transforms passive reading into active learning. Sales training requires hearing tone, pacing, and delivery - not just reading words.

**Technical considerations**:
- Need to sync audio timestamps with transcript word timestamps
- AssemblyAI provides word-level timestamps in transcription response
- Audio files stored in Supabase Storage (`call-recordings` bucket)
- Consider using HTML5 audio API or React audio library

---

## Priority 2: Active Learning Tools

### 2. Highlight & Annotation System ⭐

**Features**:
- Color-coded highlighting system:
  - 🟢 **Green**: Great technique (strong opener, rapport building, effective close)
  - 🔴 **Red**: What NOT to do (mistakes, poor handling)
  - 🟡 **Yellow**: Objection moments (price, timing, competitor mentions)
  - 🔵 **Blue**: Successful close attempts
  - 🟣 **Purple**: Key learning moment
- Click-and-drag to highlight text sections
- Add personal notes/annotations at specific timestamps
- Save highlights to user profile
- View all highlights across calls (personal highlight library)

**Why it matters**: Sales success is about pattern recognition. Reps need to identify and remember what techniques work.

**Technical considerations**:
- Store highlights in database with user_id, transcript_id, start_time, end_time, color, note
- Consider using a rich text highlighting library
- Need to handle overlapping highlights

**Database addition needed**:
```sql
CREATE TABLE transcript_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  transcript_id UUID REFERENCES transcripts(id) NOT NULL,
  start_time DECIMAL NOT NULL,
  end_time DECIMAL NOT NULL,
  color VARCHAR(20) NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Priority 3: Mobile Experience

### 4. Mobile-Optimized Design ⭐

**Features**:
- Responsive design that works great on mobile (320px+)
- Bottom-sheet audio player that stays accessible while scrolling
- Swipe gestures for navigation
- Large, touch-friendly controls
- Offline capability (download for offline training)
- Progressive Web App (PWA) for home screen installation

**Why it matters**: Sales reps train on the go - in their car between appointments, during breaks, before bed. Mobile is not optional.

**Technical considerations**:
- Use mobile-first responsive design
- Consider bottom drawer component for player
- Test on iOS and Android
- Consider service workers for offline support

---

## Priority 4: Motivation & Engagement

### 3. Gamification & Progress Tracking

**Features**:
- **Personal Stats Dashboard**:
  - Total calls reviewed
  - Total training time
  - Training streaks (days in a row)
  - This week's progress
- **Achievement Badges**:
  - "First Call" - reviewed first call
  - "Marathon Trainer" - 10 calls in one day
  - "Objection Master" - highlighted 20 objection moments
  - "Consistent Learner" - 7 day streak
  - "Sales Scholar" - 100 calls reviewed
- **Progress Bars**:
  - Completion percentage per call
  - Weekly training goals
- **Leaderboards** (optional team feature):
  - Most calls reviewed this week
  - Longest training streak
  - Most annotations added

**Why it matters**: Sales training can be dry. Gamification keeps reps engaged and creates healthy competition.

**Technical considerations**:
- Track user activity in database
- Calculate achievements server-side or client-side
- Consider notification system for achievement unlocks
- Privacy considerations for leaderboards

**Database additions needed**:
```sql
CREATE TABLE user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  transcript_id UUID REFERENCES transcripts(id),
  activity_type VARCHAR(50) NOT NULL, -- 'viewed', 'completed', 'highlighted', etc.
  duration_seconds INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  achievement_code VARCHAR(50) NOT NULL,
  unlocked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_code)
);
```

---

## Priority 5: Smart Discovery & Search

### 5. Smart Tagging/Categorization

**Features**:
- **Manual & Auto-tagging**:
  - Common tags: "Door Approach", "Objection Handling", "Rapport Building", "Closing Technique", "Follow-up", "Referral Ask"
  - AI-suggested tags based on transcript content
- **Filtering System**:
  - Filter calls by tags
  - Filter by sentiment (positive/challenging/neutral)
  - Filter by length
  - Filter by success outcome
- **Smart Search**:
  - "Show me 5 examples of handling price objections"
  - "Find calls with successful closes"
  - Full-text search across all transcripts
- **Curated Playlists**:
  - "Top 10 Best Closes"
  - "Handling Common Objections"
  - "Perfect Door Approaches"

**Why it matters**: Targeted learning. Instead of random calls, reps can focus on specific skills they want to improve.

**Technical considerations**:
- AssemblyAI provides topic detection (auto chapters feature)
- Could use LLM to suggest tags based on content
- PostgreSQL full-text search for keyword searches
- Many-to-many relationship for tags

**Database additions needed**:
```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50), -- 'technique', 'outcome', 'phase', etc.
  color VARCHAR(20)
);

CREATE TABLE transcript_tags (
  transcript_id UUID REFERENCES transcripts(id),
  tag_id UUID REFERENCES tags(id),
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (transcript_id, tag_id)
);
```

---

## Priority 6: Visual Enhancements

### 6. Visual Engagement Elements

**Features**:
- **Audio Waveform Visualization**:
  - Visual representation of audio amplitude
  - Shows loud/quiet moments at a glance
  - Click waveform to jump to that point
- **Sentiment Indicators**:
  - Visual markers showing sentiment throughout call
  - Color-coded timeline (green = positive, red = negative, gray = neutral)
  - Helps identify when conversation turns
- **Speaker Differentiation**:
  - Different colors for different speakers
  - Clear visual separation between sales rep and customer
  - Avatar or initial badges for each speaker
- **Scroll Position Indicator**:
  - Mini-map showing position in transcript
  - Highlight density visualization
- **Time Markers**:
  - Timestamp every 30 seconds or at speaker changes
  - Visual chapter markers for key moments

**Why it matters**: Visual learners need more than text. Breaking up content makes long calls less intimidating.

**Technical considerations**:
- Waveform generation can be CPU intensive - consider generating on upload
- AssemblyAI provides sentiment analysis per sentence
- Use CSS for visual differentiation
- Consider canvas or SVG for visualizations

---

## Future Considerations

### Additional Ideas (Not Prioritized)
- **Quiz Mode**: Test comprehension after listening to a call
- **Coaching Notes**: Allow managers to leave feedback on specific moments
- **Comparison View**: Side-by-side comparison of good vs bad examples
- **Practice Mode**: Record yourself and compare to expert examples
- **Custom Playlists**: Users create their own training playlists
- **Share Highlights**: Share specific moments with team
- **Integration**: Export highlights to note-taking apps
- **AI Coach**: Chatbot that answers questions about sales techniques

---

## Implementation Notes

### Phase 1 (Current)
- ✅ Basic transcription with PII redaction
- 🚧 Interactive audio player with sync

### Phase 2 (Next)
- Highlight & annotation system
- Mobile optimization

### Phase 3
- Gamification & progress tracking
- Smart tagging

### Phase 4
- Visual enhancements
- Advanced features

---

## Success Metrics

How we'll know if these UX improvements are working:

1. **Engagement**:
   - Average time spent per session
   - Number of calls reviewed per user
   - Return visit frequency

2. **Active Learning**:
   - Number of highlights created
   - Number of annotations added
   - Use of speed controls

3. **Mobile Usage**:
   - % of traffic from mobile devices
   - Mobile session duration vs desktop

4. **Completion**:
   - % of calls listened to completion
   - Training streak statistics

---

**Last Updated**: 2025-12-09
**Next Review**: After Phase 1 completion
