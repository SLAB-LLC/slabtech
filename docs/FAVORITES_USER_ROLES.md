# Favorites Feature - User Roles & Permissions

## Overview
The favorites feature is **fully functional for all user types** in the SLAB application. Each user has their own personal favorites, regardless of their role.

## User Roles

### 1. Super Admin
- **Access**: Full access to all admin features
- **Favorites**: ✅ Can favorite conversations from any transcript
- **Star Button**: ✅ Visible on all conversation cards in `/transcripts/[id]`
- **Dashboard**: Can view transcripts via `/admin` → "View Transcripts"

### 2. Company Admin (`admin` role)
- **Access**: Manage their company's users and transcripts
- **Favorites**: ✅ Can favorite conversations from accessible transcripts
- **Star Button**: ✅ Visible on all conversation cards
- **Dashboard**: Access via company-specific dashboard

### 3. Regular User (`user` role)
- **Access**: View assigned or subscribed transcripts
- **Favorites**: ✅ Can favorite conversations from their transcripts
- **Star Button**: ✅ Visible on conversation cards in `/user/transcripts/[id]`
- **Dashboard**: ✅ Has dedicated Favorites tab at `/user/dashboard`

## How Favorites Work

### Personal Favorites
- **Each user has their own favorites** - not shared within company
- **User ID-based**: Favorites are tied to `user_id` from `auth.users`
- **Role-independent**: Works the same for super_admins, admins, and users

### Multi-Tenancy
- **Company isolation**: `company_id` stored for data segregation
- **Future analytics**: Company-level reporting on favorite patterns
- **Cascade deletion**: Favorites auto-delete if user or company is removed

## Database Schema

```sql
CREATE TABLE user_favorites (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(user_id, conversation_id)
);
```

## Row Level Security (RLS) Policies

### SELECT Policy
```sql
CREATE POLICY "Users can view own favorites"
  ON user_favorites FOR SELECT
  USING (auth.uid() = user_id);
```
- ✅ Super admins can view their favorites
- ✅ Company admins can view their favorites
- ✅ Regular users can view their favorites

### INSERT Policy
```sql
CREATE POLICY "Users can insert own favorites"
  ON user_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```
- ✅ All authenticated users can add favorites

### UPDATE Policy
```sql
CREATE POLICY "Users can update own favorites"
  ON user_favorites FOR UPDATE
  USING (auth.uid() = user_id);
```
- ✅ Users can edit notes on their own favorites

### DELETE Policy
```sql
CREATE POLICY "Users can delete own favorites"
  ON user_favorites FOR DELETE
  USING (auth.uid() = user_id);
```
- ✅ Users can remove their own favorites

## Implementation Details

### Star Button Component
**Location**: `src/components/transcripts/ConversationCard.tsx`

**Features**:
- Filled gold star (⭐) when favorited
- Empty gray star when not favorited
- Hover tooltip: "Add to favorites" / "Remove from favorites"
- Click prevents conversation selection (`e.stopPropagation()`)

### Favorites Management
**Location**: `src/components/transcripts/ConversationList.tsx`

**Functions**:
1. **Fetch favorites on mount**:
   ```typescript
   useEffect(() => {
     // Fetches favorites for currently displayed conversations
     // Works for any authenticated user (admin or regular user)
   }, [conversations])
   ```

2. **Toggle favorite**:
   ```typescript
   const handleToggleFavorite = async (conversationId, isFavorited) => {
     if (isFavorited) {
       // Remove from favorites
       await supabase.from('user_favorites').delete()...
     } else {
       // Add to favorites
       await supabase.from('user_favorites').insert({
         user_id: user.id,
         company_id: userProfile?.company_id,
         conversation_id: conversationId
       })
     }
   }
   ```

## User Experience

### For Regular Users
1. Navigate to `/user/dashboard`
2. Click on any conversation
3. See star button on each conversation card
4. Click star to favorite/unfavorite
5. View all favorites in "Favorites" tab on dashboard

### For Admins
1. Navigate to `/admin` → "View Transcripts"
2. Click on any transcript
3. See star button on each conversation card
4. Click star to favorite/unfavorite
5. Favorites are personal (not visible to other admins)

## Setup Instructions

### 1. Run Migration
Execute `favorites-table-migration.sql` in Supabase SQL Editor:
```bash
# Creates user_favorites table
# Sets up RLS policies
# Creates indexes
# Adds updated_at trigger
```

### 2. Verify RLS
- RLS should be enabled: `ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;`
- Policies should allow users to manage their own favorites
- Test with different user roles to confirm access

### 3. Test Functionality
- [ ] Super admin can favorite conversations
- [ ] Company admin can favorite conversations
- [ ] Regular user can favorite conversations
- [ ] Star button shows correct state (filled/empty)
- [ ] Favorites tab shows correct count
- [ ] Clicking star toggles favorite status
- [ ] Favorites are user-specific (not shared)

## Future Enhancements

### Optional Features
1. **Add notes to favorites**: Already supported in schema, needs UI
2. **Share favorites**: Allow users to share favorite conversations
3. **Company-wide favorites**: Separate table for company favorites
4. **Favorite collections**: Group favorites into custom playlists
5. **Export favorites**: Download list of favorite conversations

## Security Considerations

### Data Isolation
- ✅ RLS policies prevent users from seeing others' favorites
- ✅ Each user can only modify their own favorites
- ✅ Company_id enables future company-level analytics

### Performance
- ✅ Indexed on user_id for fast lookups
- ✅ Indexed on conversation_id for joins
- ✅ Indexed on company_id for reporting
- ✅ Unique constraint prevents duplicate favorites

### Cascade Behavior
- ✅ User deletion → favorites auto-deleted
- ✅ Company deletion → favorites auto-deleted
- ⚠️ Conversation deletion → favorites NOT auto-deleted (foreign key needed)

## Troubleshooting

### Star button not appearing
- Check that ConversationCard receives `conversationId` prop
- Verify ConversationList passes `onToggleFavorite` callback
- Ensure component is used in user or admin transcript view

### Favorites not saving
- Check RLS policies are enabled
- Verify user is authenticated (`auth.uid()` is set)
- Check `company_id` exists in user_profiles table
- Review browser console for errors

### Favorites not loading
- Verify migration has been run
- Check `user_favorites` table exists
- Ensure indexes are created
- Review Supabase logs for RLS policy violations

## Summary

✅ **Favorites work for ALL user types**:
- Super admins
- Company admins
- Regular users

✅ **Each user has personal favorites**:
- Not shared within company
- User-specific and private
- Managed via star button on conversations

✅ **Proper multi-tenancy**:
- Company_id stored for isolation
- RLS policies enforce user-level access
- Ready for company-level analytics
