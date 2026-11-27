import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  RECEIPT_STORAGE_QUOTA_BYTES,
  checkReceiptStorageQuota,
} from "@/lib/expenses/split-engine";
import { createClient } from "@/lib/supabase/server";

const MAX_SINGLE_RECEIPT_BYTES = 25 * 1024 * 1024; // 25 MB per file

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

  if (file.size > MAX_SINGLE_RECEIPT_BYTES) {
    return NextResponse.json(
      { error: "Receipt file must be 25 MB or smaller." },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("receipt_storage_used_bytes")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message || "Unable to verify receipt storage quota." },
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
        error:
          "Receipt storage full (500 MB). Expense will be logged without receipt.",
        usedBytes,
        quotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
      },
      { status: 413 },
    );
  }

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const storagePath = `${user.id}/${groupId || "general"}/${Date.now()}-${sanitizedName}`;

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

  await supabase
    .from("users")
    .update({ receipt_storage_used_bytes: quotaCheck.projectedBytes })
    .eq("id", user.id);

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
