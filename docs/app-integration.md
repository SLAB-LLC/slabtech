# How the SLAB app connects to the backend

A handoff for anyone working on the recording pipeline or the coach bot. It covers what the mobile app (SLAB-LLC/slab-mobile) reads, what it expects the pipeline to write, and where you can plug in.

Status as of 2026-10-27: the app renovation (tenant theming, five tabs, XP) is in slab-mobile PR #3. The matching SQL is in slabtech PR #8 and has been run on the production Supabase.

## The big picture

```
Plaud device ──> (Plaud config / upload) ──> Supabase Storage `call-recordings`
                                                   │
                     slabtech /api/process-audio ──┤  creates `transcripts` row (status 'processing')
                                                   │  submits audio to AssemblyAI (PII redacted)
      slabtech /api/transcripts/[id]/status ───────┤  polls AssemblyAI, Claude redaction pass,
                                                   │  writes transcript_redacted + redacted audio,
                                                   │  splits the day into `conversations` rows,
                                                   │  status 'completed'
                                                   ▼
                        Mobile app (Supabase JS, the rep's own session, RLS applies)
                        Vault tab ─ Full Days = transcripts, Reels = conversations (upvotes)
```

The app never uploads audio. Recording comes from Plaud, so the pipeline is the only writer of recordings. The app only reads them.

## Multi-company (tenants)

Every company is a tenant. Rows carry `company_id` (from `companies`), and a rep's company is `user_profiles.company_id`. Ace is one company of many, so nothing in the pipeline or the app should be hard-coded to Ace.

Per-company app settings live in `company_app_config` (one row per company: `theme`, `features`, `labels` JSONB). See `sql/company-app-config-migration.sql`. The app deep-merges that row over built-in SLAB defaults. Useful fields for the pipeline:

- `features.vault` turns the Vault tab on or off.
- `features.vaultUnlockXp` (default 500) is the total XP a rep needs before the Vault opens.
- `theme.coach.name` (Marshall for now) is the coach's display name.

## What a recording looks like to the app

### `transcripts`: one row per recorded day (Vault > Full Days)

The app lists completed days grouped by `salesperson_name`, newest first, and opens one in the transcript player. Columns the app reads:

| Column | Used for |
|---|---|
| `id`, `created_at` | identity, fallback date |
| `recording_date` (YYYY-MM-DD) | the day shown in the list. Please always fill this in; otherwise the upload time is shown |
| `salesperson_name`, `salesperson_id` | which rep's section it appears under |
| `company_id` | tenant. Must be set |
| `status` | `processing` / `completed` / `error`. The list shows every status; a day that is still processing opens to a "check back" state |
| `transcript_redacted` (JSON: `text`, `words[] {word,start,end,speaker}`, `pii_matches[]`) | transcript view and word-synced playback |
| `redacted_file_storage_path` (falls back to `file_storage_path`) | audio playback via a signed URL from `call-recordings` |
| `area_type`, `actual_sales_count`, `expected_customer_count`, `upload_notes` | day details |

### `conversations`: one row per door (Vault > Reels)

Each completed day is split into conversations: `transcript_id`, `conversation_number`, `start_time`/`end_time` (seconds into the day's audio), `speakers`, `sales_rep_speaker`, `category` (`interaction` | `pitch` | `sale` | `uncategorized`), `objections`, `objections_with_text`, `has_price_mention`, `word_count`, `duration_seconds`. Reels ranks them by `conversation_upvotes`. See `sql/conversations-migration.sql`.

### Who can see a day (important)

Today the app's Vault shows a rep the days they are allowed to see by **either**:

- `transcript_assignments` (a row linking `transcript_id` to the rep's `user_id`), or
- `salesperson_subscriptions` (the rep follows a salesperson by name, so they see all of that salesperson's days).

RLS on `transcripts` enforces the same rules. So a newly processed day **does not reach any rep unless an assignment or a subscription covers it.** If the pipeline should "push to the public", that step means creating those rows, or changing the rule.

Duncan's target (renovation phase 6, not built yet): the Vault shows **every completed day from the rep's own company**, plus a **Marshall pack** that every company sees. Two suggested shapes for that:

1. A `visibility` column on `transcripts` (`company` | `global` | `private`). RLS then allows `company_id = my company AND visibility = 'company'`, or `visibility = 'global'` for the Marshall pack. The pipeline sets it when processing finishes (or a manager publishes it).
2. Keep assignments, and have the pipeline bulk-assign each finished day to every rep in the company.

Option 1 is simpler and scales better. If you pick a different approach, write it down here so the app side matches.

## XP: what reps earn

XP is server-owned. Only the `grant_xp(reason, source_id, tz)` database function writes `xp_events`; totals come from the `user_xp_totals` view. See `sql/xp-engine-migration.sql`. Reasons today:

`lesson_complete`, `book_pass`, `boss_win`, `vault_minute` (listening in the Vault, capped daily), `library_open` and `coach_ask` (capped daily).

`grant_xp` runs as the signed-in rep (`auth.uid()`). If the pipeline ever needs to award XP, for example for a rep's own recorded day, add a new reason to `grant_xp` rather than inserting into `xp_events` directly.

## The coach bot (Ask Marshall)

The app's Chat tab is a shell that calls one HTTP endpoint, set in the app as `EXPO_PUBLIC_COACH_URL`. Until that is set, the app shows a placeholder reply.

Request: `POST`, JSON, header `Authorization: Bearer <rep's Supabase access token>`.

```json
{
  "coach": "Marshall",
  "user": { "id": "uuid", "name": "Rep Name", "companyId": "uuid", "companyName": "Ace" },
  "messages": [
    { "role": "user", "content": "How do I handle 'I already have a guy'?" },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

Response: `200` with `{ "reply": "text" }`. Any other status shows "Marshall couldn't answer right now".

Notes:
- Verify the bearer token with Supabase (`auth.getUser(token)`) and trust the user id from the token, not from the body.
- `messages` is the last 40 turns, kept on the phone. The server doesn't need to store history.
- The app awards `coach_ask` XP after each real answer.
- The bot can ground answers in the rep's company's transcripts and conversations using the tables above.

## SQL and environments

- SQL lives in `sql/` and is run by hand in the Supabase SQL editor. Each app file ends with an `-- End of ...` marker; if that line is missing after pasting, the copy was clipped.
- The app reads with the anon key plus the rep's session, so everything it sees must be allowed by RLS. Pipeline code using the service role bypasses RLS, so it must set `company_id` itself.
