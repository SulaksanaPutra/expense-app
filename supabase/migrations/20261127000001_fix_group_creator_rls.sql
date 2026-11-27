-- Fix chicken-and-egg RLS deadlock when a user creates a new Split Group
-- and immediately inserts themselves as the initial ADMIN in group_members.
-- Previously:
--   1. group_members_insert_admin_or_creator checked EXISTS (SELECT 1 FROM public.groups ...)
--   2. groups_select_members only allowed SELECT when public.is_group_member(id) was already true
--   3. So inserting the creator into group_members failed with 42501 RLS violation.

CREATE OR REPLACE FUNCTION public.is_group_creator(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.created_by = p_user_id
  );
$$;

DROP POLICY IF EXISTS "groups_select_members" ON public.groups;
CREATE POLICY "groups_select_members"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(id)
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "group_members_insert_admin_or_creator" ON public.group_members;
CREATE POLICY "group_members_insert_admin_or_creator"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR (
      user_id = auth.uid()
      AND role = 'ADMIN'
      AND status = 'ACTIVE'
      AND public.is_group_creator(group_id)
    )
  );
