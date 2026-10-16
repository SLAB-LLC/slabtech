-- Profile Pictures Storage Bucket Setup
-- Run this in your Supabase SQL Editor or Dashboard

-- Create the storage bucket for profile pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for profile pictures bucket
CREATE POLICY "Users can upload their own profile picture"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-pictures' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own profile picture"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-pictures' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own profile picture"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-pictures' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Profile pictures are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'profile-pictures');

-- Add profile_picture_url column to user_profiles if it doesn't exist
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
