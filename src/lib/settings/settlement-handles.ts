import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SettlementHandleProvider } from "@/types/database";

export interface SettlementHandleItem {
  id: string;
  userId: string;
  provider: SettlementHandleProvider;
  handle: string;
  displayNote: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SETTLEMENT_HANDLE_PROVIDERS: readonly SettlementHandleProvider[] = [
  "VENMO",
  "ZELLE",
  "CASH_APP",
] as const;

export const PROVIDER_LABELS: Record<SettlementHandleProvider, string> = {
  VENMO: "Venmo",
  ZELLE: "Zelle",
  CASH_APP: "Cash App",
};

interface SettlementHandleRow {
  id: string;
  user_id: string;
  provider: SettlementHandleProvider;
  handle: string;
  display_note: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function mapHandleRow(row: SettlementHandleRow): SettlementHandleItem {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    handle: row.handle,
    displayNote: row.display_note ?? null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sortSettlementHandles(
  handles: SettlementHandleItem[],
): SettlementHandleItem[] {
  return [...handles].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function normalizeProvider(
  raw: unknown,
):
  | { ok: true; value: SettlementHandleProvider }
  | { ok: false; message: string } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      message: "Provider must be one of Venmo, Zelle, or Cash App.",
    };
  }
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (
    normalized === "VENMO" ||
    normalized === "ZELLE" ||
    normalized === "CASH_APP"
  ) {
    return { ok: true, value: normalized };
  }
  return {
    ok: false,
    message: "Provider must be one of Venmo, Zelle, or Cash App.",
  };
}

export function normalizeHandleTag(
  raw: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      message: "Handle / Account Tag is required.",
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Handle / Account Tag is required.",
    };
  }
  if (trimmed.length > 120) {
    return {
      ok: false,
      message: "Handle / Account Tag must be 120 characters or fewer.",
    };
  }
  return { ok: true, value: trimmed };
}

export function normalizeDisplayNote(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      message: "Display note must be text.",
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (trimmed.length > 120) {
    return {
      ok: false,
      message: "Display note must be 120 characters or fewer.",
    };
  }
  return { ok: true, value: trimmed };
}

export type ListSettlementHandlesResult =
  | { ok: true; handles: SettlementHandleItem[] }
  | { ok: false; status: number; code: string; message: string };

export async function listSettlementHandles(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ListSettlementHandlesResult> {
  const { data, error } = await supabase
    .from("settlement_handles")
    .select(
      "id, user_id, provider, handle, display_note, is_default, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: error.message || "Unable to load settlement handles.",
    };
  }

  const mapped = sortSettlementHandles(
    ((data ?? []) as SettlementHandleRow[]).map(mapHandleRow),
  );
  return { ok: true, handles: mapped };
}

export interface CreateSettlementHandleInput {
  provider?: unknown;
  handle?: unknown;
  display_note?: unknown;
  is_default?: unknown;
}

export type MutateSettlementHandleResult =
  | {
      ok: true;
      handle: SettlementHandleItem;
      handles: SettlementHandleItem[];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function createSettlementHandle(
  supabase: SupabaseClient<Database>,
  userId: string,
  rawInput: unknown,
): Promise<MutateSettlementHandleResult> {
  if (!rawInput || typeof rawInput !== "object") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYLOAD",
      message: "Invalid settlement handle payload.",
    };
  }

  const input = rawInput as CreateSettlementHandleInput;

  const providerCheck = normalizeProvider(input.provider);
  if (!providerCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PROVIDER",
      message: providerCheck.message,
    };
  }

  const handleCheck = normalizeHandleTag(input.handle);
  if (!handleCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_HANDLE",
      message: handleCheck.message,
    };
  }

  const noteCheck = normalizeDisplayNote(input.display_note);
  if (!noteCheck.ok) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DISPLAY_NOTE",
      message: noteCheck.message,
    };
  }

  let isDefault = false;
  if (input.is_default !== undefined) {
    if (typeof input.is_default !== "boolean") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_IS_DEFAULT",
        message: "is_default must be a boolean.",
      };
    }
    isDefault = input.is_default;
  }

  // Clear existing default(s) before inserting a new default handle so single-default
  // invariant holds across both DB trigger environments and in-memory test doubles.
  if (isDefault) {
    const clearRes = await supabase
      .from("settlement_handles")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("is_default", true);

    if (clearRes.error) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message:
          clearRes.error.message || "Unable to update existing default handle.",
      };
    }
  }

  const { data, error } = await supabase
    .from("settlement_handles")
    .insert({
      user_id: userId,
      provider: providerCheck.value,
      handle: handleCheck.value,
      display_note: noteCheck.value,
      is_default: isDefault,
    })
    .select(
      "id, user_id, provider, handle, display_note, is_default, created_at, updated_at",
    )
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: error?.message || "Failed to create settlement handle.",
    };
  }

  const created = mapHandleRow(data as SettlementHandleRow);
  const listRes = await listSettlementHandles(supabase, userId);
  return {
    ok: true,
    handle: created,
    handles: listRes.ok ? listRes.handles : [created],
  };
}

export interface UpdateSettlementHandleInput {
  provider?: unknown;
  handle?: unknown;
  display_note?: unknown;
  is_default?: unknown;
}

export async function updateSettlementHandle(
  supabase: SupabaseClient<Database>,
  userId: string,
  handleId: string,
  rawInput: unknown,
): Promise<MutateSettlementHandleResult> {
  if (!handleId || !handleId.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_HANDLE_ID",
      message: "Settlement handle ID is required.",
    };
  }

  if (!rawInput || typeof rawInput !== "object") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYLOAD",
      message: "Invalid settlement handle update payload.",
    };
  }

  const input = rawInput as UpdateSettlementHandleInput;

  const { data: existing, error: fetchErr } = await supabase
    .from("settlement_handles")
    .select(
      "id, user_id, provider, handle, display_note, is_default, created_at, updated_at",
    )
    .eq("id", handleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: fetchErr.message || "Unable to load settlement handle.",
    };
  }

  if (!existing) {
    return {
      ok: false,
      status: 404,
      code: "HANDLE_NOT_FOUND",
      message: "Settlement handle not found.",
    };
  }

  const existingRow = existing as SettlementHandleRow;
  let nextProvider = existingRow.provider;
  if (input.provider !== undefined) {
    const providerCheck = normalizeProvider(input.provider);
    if (!providerCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_PROVIDER",
        message: providerCheck.message,
      };
    }
    nextProvider = providerCheck.value;
  }

  let nextHandle = existingRow.handle;
  if (input.handle !== undefined) {
    const handleCheck = normalizeHandleTag(input.handle);
    if (!handleCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_HANDLE",
        message: handleCheck.message,
      };
    }
    nextHandle = handleCheck.value;
  }

  let nextDisplayNote = existingRow.display_note;
  if (input.display_note !== undefined) {
    const noteCheck = normalizeDisplayNote(input.display_note);
    if (!noteCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_DISPLAY_NOTE",
        message: noteCheck.message,
      };
    }
    nextDisplayNote = noteCheck.value;
  }

  let nextIsDefault = existingRow.is_default;
  if (input.is_default !== undefined) {
    if (typeof input.is_default !== "boolean") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_IS_DEFAULT",
        message: "is_default must be a boolean.",
      };
    }
    nextIsDefault = input.is_default;
  }

  if (nextIsDefault) {
    const clearRes = await supabase
      .from("settlement_handles")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("is_default", true)
      .neq("id", handleId);

    if (clearRes.error) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message:
          clearRes.error.message || "Unable to update existing default handle.",
      };
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from("settlement_handles")
    .update({
      provider: nextProvider,
      handle: nextHandle,
      display_note: nextDisplayNote,
      is_default: nextIsDefault,
    })
    .eq("id", handleId)
    .eq("user_id", userId)
    .select(
      "id, user_id, provider, handle, display_note, is_default, created_at, updated_at",
    )
    .maybeSingle();

  if (updateErr || !updated) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: updateErr?.message || "Failed to update settlement handle.",
    };
  }

  const mapped = mapHandleRow(updated as SettlementHandleRow);
  const listRes = await listSettlementHandles(supabase, userId);
  return {
    ok: true,
    handle: mapped,
    handles: listRes.ok ? listRes.handles : [mapped],
  };
}

export type DeleteSettlementHandleResult =
  | {
      ok: true;
      deletedId: string;
      handles: SettlementHandleItem[];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function deleteSettlementHandle(
  supabase: SupabaseClient<Database>,
  userId: string,
  handleId: string,
): Promise<DeleteSettlementHandleResult> {
  if (!handleId || !handleId.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_HANDLE_ID",
      message: "Settlement handle ID is required.",
    };
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("settlement_handles")
    .select("id")
    .eq("id", handleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: fetchErr.message || "Unable to verify settlement handle.",
    };
  }

  if (!existing) {
    return {
      ok: false,
      status: 404,
      code: "HANDLE_NOT_FOUND",
      message: "Settlement handle not found.",
    };
  }

  const { error: deleteErr } = await supabase
    .from("settlement_handles")
    .delete()
    .eq("id", handleId)
    .eq("user_id", userId);

  if (deleteErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: deleteErr.message || "Failed to delete settlement handle.",
    };
  }

  const listRes = await listSettlementHandles(supabase, userId);
  return {
    ok: true,
    deletedId: handleId,
    handles: listRes.ok ? listRes.handles : [],
  };
}
