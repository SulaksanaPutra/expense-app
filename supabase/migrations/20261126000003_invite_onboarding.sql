-- LedgerSplit Invite Onboarding & Token Revocation Migration
-- Adds per-group invite_token_version for immediate HMAC invite link revocation.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS invite_token_version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT groups_invite_token_version_pos_chk CHECK (invite_token_version >= 1);
