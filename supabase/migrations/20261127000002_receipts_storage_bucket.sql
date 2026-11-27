-- LedgerSplit Receipt Storage Bucket, Storage RLS, and Atomic 500 MB Quota RPCs

-- 1. Provision private 'receipts' storage bucket (25 MiB max per individual file)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  FALSE,
  26214400,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS policies on storage.objects for bucket 'receipts'
-- Path format: <uploader_user_id>/<group_id_or_general>/<timestamp>-<filename>
DROP POLICY IF EXISTS "receipts_insert_own" ON storage.objects;
CREATE POLICY "receipts_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "receipts_select_owner_or_group_member" ON storage.objects;
CREATE POLICY "receipts_select_owner_or_group_member"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_group_member(((storage.foldername(name))[2])::uuid)
      )
    )
  );

DROP POLICY IF EXISTS "receipts_delete_own" ON storage.objects;
CREATE POLICY "receipts_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Atomic per-user 500 MB (524,288,000 bytes) quota reservation & rollback helpers
CREATE OR REPLACE FUNCTION public.reserve_receipt_storage_bytes(
  p_file_bytes BIGINT,
  p_quota_bytes BIGINT DEFAULT 524288000
)
RETURNS TABLE(allowed BOOLEAN, used_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_used BIGINT;
  v_current_used BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_file_bytes IS NULL OR p_file_bytes <= 0 THEN
    RAISE EXCEPTION 'File byte size must be positive';
  END IF;

  UPDATE public.users
  SET receipt_storage_used_bytes = receipt_storage_used_bytes + p_file_bytes
  WHERE id = v_user_id
    AND receipt_storage_used_bytes < p_quota_bytes
    AND receipt_storage_used_bytes + p_file_bytes <= p_quota_bytes
  RETURNING receipt_storage_used_bytes INTO v_new_used;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_new_used;
    RETURN;
  END IF;

  SELECT u.receipt_storage_used_bytes INTO v_current_used
  FROM public.users u
  WHERE u.id = v_user_id;

  RETURN QUERY SELECT FALSE, COALESCE(v_current_used, 0::BIGINT);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_receipt_storage_bytes(
  p_file_bytes BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_used BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_file_bytes IS NULL OR p_file_bytes <= 0 THEN
    SELECT u.receipt_storage_used_bytes INTO v_new_used
    FROM public.users u
    WHERE u.id = v_user_id;
    RETURN COALESCE(v_new_used, 0::BIGINT);
  END IF;

  UPDATE public.users
  SET receipt_storage_used_bytes = GREATEST(0::BIGINT, receipt_storage_used_bytes - p_file_bytes)
  WHERE id = v_user_id
  RETURNING receipt_storage_used_bytes INTO v_new_used;

  RETURN COALESCE(v_new_used, 0::BIGINT);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_receipt_storage_bytes(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_receipt_storage_bytes(BIGINT) TO authenticated;
