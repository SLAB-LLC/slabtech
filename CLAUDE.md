# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Architecture Overview

**Slab Voice** is a Next.js 15 application for voice transcription with PII redaction, using AssemblyAI for transcription and Supabase for database/auth/storage.

### Tech Stack
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL, Auth, Storage)
- AssemblyAI (transcription + PII redaction)

### Key Data Flow

1. **Customer uploads audio** → File goes to Supabase Storage (`call-recordings` bucket)
2. **API creates signed URL** → Passed to AssemblyAI for processing
3. **AssemblyAI transcribes** → Returns redacted transcript + optional redacted audio
4. **Results stored** → Transcript JSON saved to `transcripts` table, redacted audio to `redacted/` path in storage

### Route Structure

```
src/app/
├── (admin)/                    # Protected admin routes (auth required)
│   ├── admin/page.tsx          # Dashboard - transcript list
│   ├── transcripts/[id]/       # Individual transcript view
│   └── layout.tsx              # Auth check wrapper
├── api/
│   ├── process-audio/          # Main transcription endpoint
│   └── admin/                  # Config management endpoints
├── auth/signout/               # Sign out handler
├── login/page.tsx              # Login page
└── page.tsx                    # Public upload form (home)
```

### Database Tables (Supabase)

- **transcripts** - Stores transcription results with metadata
- **redaction_config** - Single-row table for PII redaction settings (id=1)

### Important Files

- `src/app/api/process-audio/route.ts` - Core transcription logic, AssemblyAI integration
- `src/utils/supabase/` - Supabase client utilities (client.ts, server.ts)
- `src/middleware.ts` - Auth session management, excludes `/api/process-audio` from auth
- `sql/` - Hand-run Supabase SQL migrations (schema, RLS policies); `sql/supabase-schema-v2.sql` is the base schema

### Path Alias

`@/*` maps to `./src/*` - use `@/utils/supabase/server` style imports.

### Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ASSEMBLYAI_API_KEY`

Refer to me as Duncan


● ## Implementation Approach

  **Default to direct implementation.** For most features and changes:
  1. Read the relevant files (typically 2-5 files max)
  2. Ask brief clarifying questions only if genuinely ambiguous
  3. Implement immediately
  4. Debug and iterate as issues arise

  **Only use plan mode when:**
  - Changes could break multiple existing systems or features
  - Significant architectural decisions are required
  - The scope is genuinely unclear after reading the code

  **Do NOT use plan mode for:**
  - Adding UI components following existing patterns
  - Creating new API endpoints following existing route patterns
  - Standard CRUD operations
  - Features contained to 1-3 files

  Duncan prefers speed and iteration over extensive upfront planning. Trust the codebase patterns, implement quickly, and fix issues as they come up.