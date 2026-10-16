-- Add profile picture URL and about section to salespeople table
ALTER TABLE salespeople
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
ADD COLUMN IF NOT EXISTS about TEXT;

-- Create storage bucket for salesperson profile pictures (run this in Supabase Storage UI or via API)
-- Bucket name: 'profile-pictures'
-- Public access: true (so images can be displayed without signed URLs)

-- Update RLS policies for profile pictures bucket if needed
-- Users should be able to READ profile pictures
-- Only admins should be able to UPLOAD/DELETE profile pictures
