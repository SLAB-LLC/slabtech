# Slab Voice

A Next.js application for voice transcription with PII redaction using AssemblyAI and Supabase.

## Tech Stack

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Supabase** (Database, Auth, Storage)
- **AssemblyAI** (Voice transcription with PII redaction)

## Phase 1: Setup Complete ✅

The following has been implemented:

1. ✅ Next.js project with App Router, TypeScript, and Tailwind CSS
2. ✅ Supabase client utilities (browser, server, middleware)
3. ✅ Environment variable configuration
4. ✅ Database schema (SQL file provided)
5. ✅ Admin authentication flow with protected routes

## Phase 2: AssemblyAI Integration Complete ✅

1. ✅ Secure API route (`/api/process-audio`) for audio processing
2. ✅ Customer-facing upload form with file upload, salesperson name, and customer name
3. ✅ AssemblyAI integration with PII redaction
4. ✅ Supabase Storage integration for audio files
5. ✅ Database integration for storing transcripts

## Phase 3: Admin Dashboard Complete ✅

1. ✅ Admin dashboard page (`/dashboard`) with sortable transcript table
2. ✅ Transcript details page (`/transcripts/[id]`) with full transcript view
3. ✅ Audio download and playback functionality with signed URLs
4. ✅ PII redaction configuration editor (`/config`)
5. ✅ Protected API routes for configuration management
6. ✅ SLAB brand design system integration

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Copy your project URL and anon key
3. Update `.env.local` with your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ASSEMBLYAI_API_KEY=your-assemblyai-api-key
```

### 3. Run Database Migrations

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `sql/supabase-schema-v2.sql`
4. Run the SQL to create the tables and policies

### 4. Configure Authentication

1. In Supabase Dashboard, go to **Authentication** > **Providers**
2. Enable **Google** OAuth provider (optional but recommended)
3. Enable **Email** provider for Magic Link authentication
4. Add your site URL to **Auth** > **URL Configuration**:
   - Site URL: `http://localhost:3000` (for development)
   - Redirect URLs: `http://localhost:3000/admin`

### 5. Create Storage Bucket

1. Go to **Storage** in Supabase Dashboard
2. Create a new bucket named `call-recordings`
3. Make it **private** (not public)
4. Add storage policies for the bucket in the SQL Editor

### 6. Set Up AssemblyAI

1. Create an account at [assemblyai.com](https://www.assemblyai.com/)
2. Get your API key from the AssemblyAI dashboard
3. Add the API key to `.env.local`:

```env
ASSEMBLYAI_API_KEY=your-assemblyai-api-key
```

### 7. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
slab-voice/
├── src/
│   ├── app/
│   │   ├── (admin)/              # Protected admin routes
│   │   │   ├── admin/
│   │   │   │   └── page.tsx      # Admin dashboard
│   │   │   └── layout.tsx        # Admin layout with auth check
│   │   ├── api/
│   │   │   └── process-audio/
│   │   │       └── route.ts      # API route for audio processing
│   │   ├── auth/
│   │   │   └── signout/
│   │   │       └── route.ts      # Sign out handler
│   │   ├── login/
│   │   │   └── page.tsx          # Login page
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Customer upload form
│   │   └── globals.css           # Global styles
│   ├── utils/
│   │   └── supabase/
│   │       ├── client.ts         # Browser Supabase client
│   │       └── server.ts         # Server Supabase client
│   └── middleware.ts             # Next.js middleware
├── sql/                          # Supabase SQL migrations
└── package.json
```

## Database Schema

### Tables

1. **transcripts** - Stores transcription results from AssemblyAI
   - `id` (UUID)
   - `created_at` (timestamp)
   - `salesperson_name` (text)
   - `customer_name` (text, optional)
   - `original_filename` (text)
   - `file_storage_path` (text) - Path to MP3 in Supabase Storage
   - `transcript_redacted` (JSONB) - AssemblyAI JSON response
   - `redaction_config_used` (text) - PII fields that were redacted

2. **redaction_config** - Single-row table for PII redaction settings
   - `id` (int, primary key = 1)
   - `pii_fields` (text) - Comma-separated list of PII types to redact

## Authentication Flow

1. User visits `/admin` (or any protected route)
2. If not authenticated, redirected to `/login`
3. User can sign in with:
   - Google OAuth
   - Magic Link (email)
4. After successful authentication, redirected to `/admin`
5. Sign out via the button in the navigation bar

## How It Works

### Customer Upload Flow

1. Customer visits the home page at `/`
2. Fills out the upload form:
   - Salesperson Name (required)
   - Customer Name (optional)
   - Audio File (MP3 or other audio format)
3. Submits the form
4. The file is uploaded to Supabase Storage (`call-recordings` bucket)
5. A signed URL is generated for the audio file
6. The current PII redaction configuration is fetched from the database
7. AssemblyAI processes the audio with PII redaction enabled
8. The transcript is saved to the database with metadata
9. User sees a success message

### API Processing Flow

The `/api/process-audio` endpoint:
1. Accepts multipart form data (file + metadata)
2. Validates the file and required fields
3. Uploads the audio file to Supabase Storage
4. Creates a signed URL (valid for 1 hour)
5. Fetches the `redaction_config` from the database
6. Calls AssemblyAI API with:
   - `audio_url: signedUrl`
   - `redact_pii: true`
   - `redact_pii_policies: [pii_fields]` when specific fields are set
7. Saves the transcript to the `transcripts` table
8. Returns success/error response

### PII Redaction

The system uses AssemblyAI's built-in PII redaction feature. The redaction configuration is stored in the `redaction_config` table and can include:
- `all` - All supported PII types
- `person_name` - Personal names
- `organization` - Company/organization names
- `location` - Cities, addresses, or locations
- `email_address` - Email addresses
- `phone_number` - Phone numbers
- `credit_card_number` - Credit card numbers
- `bank_account_number` - Bank/account numbers
- `us_social_security_number` - US SSNs
- `date_of_birth` - Date of birth
- `age` - Age mentions

## Admin Features

### Dashboard (`/dashboard`)

The admin dashboard displays all transcripts in a sortable table with:
- Date and time of recording
- Salesperson and customer names
- Original filename
- PII redaction config used
- Quick link to view details

### Transcript Details (`/transcripts/[id]`)

Each transcript has a detailed view showing:
- Full recording metadata
- Complete redacted transcript text
- Audio player for listening to the recording
- Download button for the audio file
- Copy-to-clipboard functionality
- Raw AssemblyAI JSON response (for debugging)

### Configuration Editor (`/config`)

Manage PII redaction settings for future uploads:
- Visual checkbox interface for PII types
- Support for AssemblyAI PII redaction policies:
  - All PII Types (comprehensive redaction)
  - Person names
  - Organizations
  - Locations
  - Email addresses
  - Phone numbers
  - Credit card numbers
  - Bank account numbers
  - US Social Security Numbers
  - Date of birth
  - Age
- Preview of configuration string
- Protected with authentication

## Design System

All admin pages use the SLAB design system with:
- **Brand Colors**: Midnight Blue, Steel Gray, Success Gold
- **Typography**: Arial with consistent heading scales
- **Components**: Card, Button, Heading, Text, Container
- **Responsive Design**: Mobile-first with Tailwind CSS

See `Docs_Design/DESIGN_SYSTEM.md` for complete guidelines.

## Future Enhancements

Potential Phase 4 features:
- Transcript search and filtering
- Bulk export to CSV/JSON
- Analytics dashboard with charts
- User management and roles
- Email notifications for completed transcriptions
- Batch audio processing
