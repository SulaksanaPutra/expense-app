import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  RECEIPT_STORAGE_QUOTA_BYTES,
  checkReceiptStorageQuota,
} from "@/lib/expenses/split-engine";
import { assertGroupWritableForLedger } from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";

const MAX_SINGLE_RECEIPT_BYTES = 25 * 1024 * 1024; // 25 MB per file
const QUOTA_FULL_MESSAGE =
  "Receipt storage full (500 MB). Expense will be logged without receipt.";

const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const ALLOWED_RECEIPT_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "pdf",
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAllowedReceiptFile(file: File): boolean {
  const mime = (file.type || "").trim().toLowerCase();
  if (mime) {
    return ALLOWED_RECEIPT_MIME_TYPES.has(mime) || mime.startsWith("image/");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_RECEIPT_EXTENSIONS.has(ext);
}

function normalizeReceiptStoragePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.startsWith("receipts://")
    ? trimmed.slice("receipts://".length)
    : trimmed;
  const normalized = withoutScheme.replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.split("/").length < 3
  ) {
    return null;
  }
  return normalized;
}

export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const rawPath = request.nextUrl.searchParams.get("path") ?? "";
  const storagePath = normalizeReceiptStoragePath(rawPath);
  if (!storagePath) {
    return NextResponse.json(
      { error: "Valid receipt storage path is required." },
      { status: 400 },
    );
  }

  const [ownerId, groupId] = storagePath.split("/");
  let authorized = ownerId === user.id;

  if (!authorized && groupId && UUID_REGEX.test(groupId)) {
    const { data: membership } = await supabase
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (
      membership &&
      (membership.status === "ACTIVE" || membership.status === "FORMER_MEMBER")
    ) {
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json(
      { error: "You do not have access to this receipt." },
      { status: 403 },
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(storagePath, 60);

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signError?.message || "Unable to generate receipt download link." },
      { status: 404 },
    );
  }

  if (request.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({ ok: true, signedUrl: signed.signedUrl });
  }

  return NextResponse.redirect(signed.signedUrl);
}

export async function POST(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart form payload." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const groupId = String(formData.get("groupId") ?? "").trim();

  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json(
      { error: "A non-empty receipt file is required." },
      { status: 400 },
    );
  }

  if (!isAllowedReceiptFile(file)) {
    return NextResponse.json(
      { error: "Receipt must be an image (PNG, JPG, WebP, GIF, HEIC) or PDF." },
      { status: 400 },
    );
  }

  if (groupId) {
    const guard = await assertGroupWritableForLedger(supabase, {
      groupId,
      userId: user.id,
      operation: "EXPENSE_CREATE",
    });
    if (!guard.ok) {
      return NextResponse.json(
        { ok: false, error: guard.message, code: guard.code },
        { status: guard.status },
      );
    }
  }

  const sanitizedName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "receipt";
  const storagePath = `${user.id}/${groupId || "general"}/${Date.now()}-${sanitizedName}`;
  const hasRpc =
    typeof (supabase as unknown as { rpc?: unknown }).rpc === "function";

  if (hasRpc) {
    // Check current quota before single-file limit so quota-full users get 413 cleanly.
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("receipt_storage_used_bytes")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        {
          error:
            profileError.message || "Unable to verify receipt storage quota.",
        },
        { status: 500 },
      );
    }

    const usedBytes = Number(profile?.receipt_storage_used_bytes ?? 0);
    const preCheck = checkReceiptStorageQuota(
      usedBytes,
      file.size,
      RECEIPT_STORAGE_QUOTA_BYTES,
    );

    if (!preCheck.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: "RECEIPT_QUOTA_EXCEEDED",
          error: QUOTA_FULL_MESSAGE,
          usedBytes,
          quotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
        },
        { status: 413 },
      );
    }

    if (file.size > MAX_SINGLE_RECEIPT_BYTES) {
      return NextResponse.json(
        { error: "Receipt file must be 25 MB or smaller." },
        { status: 400 },
      );
    }

    const { data: reserveRows, error: reserveError } = await supabase.rpc(
      "reserve_receipt_storage_bytes",
      {
        p_file_bytes: file.size,
        p_quota_bytes: RECEIPT_STORAGE_QUOTA_BYTES,
      },
    );

    if (reserveError) {
      return NextResponse.json(
        {
          error:
            reserveError.message || "Unable to reserve receipt storage quota.",
        },
        { status: 500 },
      );
    }

    const reserveRow = Array.isArray(reserveRows) ? reserveRows[0] : null;
    if (!reserveRow?.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: "RECEIPT_QUOTA_EXCEEDED",
          error: QUOTA_FULL_MESSAGE,
          usedBytes: Number(reserveRow?.used_bytes ?? usedBytes),
          quotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      await supabase.rpc("release_receipt_storage_bytes", {
        p_file_bytes: file.size,
      });

      return NextResponse.json(
        {
          ok: false,
          code: "RECEIPT_UPLOAD_UNAVAILABLE",
          error:
            "Receipt file storage is unavailable right now. Expense will be logged without receipt.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        receiptUrl: `receipts://${storagePath}`,
        sizeBytes: file.size,
        usedBytes: Number(reserveRow.used_bytes),
      },
      { status: 201 },
    );
  }

  // Fallback path for mocked Supabase clients without .rpc()
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("receipt_storage_used_bytes")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      {
        error:
          profileError.message || "Unable to verify receipt storage quota.",
      },
      { status: 500 },
    );
  }

  const usedBytes = Number(profile?.receipt_storage_used_bytes ?? 0);
  const quotaCheck = checkReceiptStorageQuota(
    usedBytes,
    file.size,
    RECEIPT_STORAGE_QUOTA_BYTES,
  );

  if (!quotaCheck.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "RECEIPT_QUOTA_EXCEEDED",
        error: QUOTA_FULL_MESSAGE,
        usedBytes,
        quotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
      },
      { status: 413 },
    );
  }

  if (file.size > MAX_SINGLE_RECEIPT_BYTES) {
    return NextResponse.json(
      { error: "Receipt file must be 25 MB or smaller." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      {
        ok: false,
        code: "RECEIPT_UPLOAD_UNAVAILABLE",
        error:
          "Receipt file storage is unavailable right now. Expense will be logged without receipt.",
      },
      { status: 503 },
    );
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ receipt_storage_used_bytes: quotaCheck.projectedBytes })
    .eq("id", user.id);

  if (updateError) {
    await supabase.storage.from("receipts").remove([storagePath]);
    return NextResponse.json(
      { error: updateError.message || "Unable to update receipt storage quota." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      receiptUrl: `receipts://${storagePath}`,
      sizeBytes: file.size,
      usedBytes: quotaCheck.projectedBytes,
    },
    { status: 201 },
  );
}
