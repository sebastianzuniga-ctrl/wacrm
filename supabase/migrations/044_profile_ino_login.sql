-- ============================================================
-- 044_profile_ino_login.sql
--
-- Adds login_ino to profiles: links a wacrm profile to a username in
-- the INO internal system (validated via loginJson.jsp). When set,
-- that user can sign in with their INO username/password instead of
-- (or in addition to) a Supabase email/password. The Supabase Auth
-- user itself is still the source of truth for sessions — on a
-- successful INO login, wacrm syncs whatever password was just typed
-- into that user's Supabase Auth record (see /api/auth/ino-login).
--
-- Profiles with login_ino set are created directly by an admin
-- (login + full name + role), NOT via the existing email-invite link
-- flow — there's no invitation step, the person just logs in with
-- their INO credentials once the admin has registered them here.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS login_ino text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_login_ino
  ON profiles (login_ino)
  WHERE login_ino IS NOT NULL;
