import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettlementHandleProvider } from "@/types/database";

const getUserMock = vi.fn();

interface InMemoryHandleRow {
  id: string;
  user_id: string;
  provider: SettlementHandleProvider;
  handle: string;
  display_note: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface InMemoryDb {
  settlement_handles: InMemoryHandleRow[];
}

let activeDb: InMemoryDb;
let idCounter = 10;

function createInMemorySupabase(db: InMemoryDb) {
  type Filter = {
    col: string;
    val: unknown;
    op: "eq" | "neq";
  };

  function filterRows<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const value = (row as Record<string, unknown>)[f.col];
        if (f.op === "neq") return value !== f.val;
        return value === f.val;
      }),
    );
  }

  return {
    auth: {
      getUser: getUserMock,
    },
    from(table: keyof InMemoryDb) {
      const rows = db[table];
      return {
        select() {
          const filters: Filter[] = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push({ col, val, op: "eq" });
              return builder;
            },
            neq(col: string, val: unknown) {
              filters.push({ col, val, op: "neq" });
              return builder;
            },
            order() {
              return builder;
            },
            async maybeSingle() {
              const matched = filterRows(rows, filters);
              return { data: matched[0] ?? null, error: null };
            },
            then<TResult1 = { data: InMemoryHandleRow[]; error: null }>(
              onfulfilled?:
                | ((value: {
                    data: InMemoryHandleRow[];
                    error: null;
                  }) => TResult1 | PromiseLike<TResult1>)
                | null,
            ) {
              const matched = filterRows(rows, filters);
              return Promise.resolve({ data: matched, error: null }).then(
                onfulfilled,
              );
            },
          };
          return builder;
        },
        insert(payload: {
          user_id: string;
          provider: SettlementHandleProvider;
          handle: string;
          display_note: string | null;
          is_default: boolean;
        }) {
          idCounter += 1;
          const now = new Date(
            Date.UTC(2026, 10, 28, 12, 0, idCounter),
          ).toISOString();
          const created: InMemoryHandleRow = {
            id: `sh-${idCounter}`,
            user_id: payload.user_id,
            provider: payload.provider,
            handle: payload.handle,
            display_note: payload.display_note,
            is_default: payload.is_default,
            created_at: now,
            updated_at: now,
          };
          rows.push(created);
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: created, error: null };
                },
              };
            },
          };
        },
        update(patch: Partial<InMemoryHandleRow>) {
          const filters: Filter[] = [];
          const applyUpdate = () => {
            const matched = filterRows(rows, filters);
            for (const row of matched) {
              Object.assign(row, patch, {
                updated_at: new Date().toISOString(),
              });
            }
            return matched;
          };
          const builder = {
            eq(col: string, val: unknown) {
              filters.push({ col, val, op: "eq" });
              return builder;
            },
            neq(col: string, val: unknown) {
              filters.push({ col, val, op: "neq" });
              return builder;
            },
            select() {
              return {
                async maybeSingle() {
                  const matched = applyUpdate();
                  return { data: matched[0] ?? null, error: null };
                },
              };
            },
            then<TResult1 = { data: InMemoryHandleRow[]; error: null }>(
              onfulfilled?:
                | ((value: {
                    data: InMemoryHandleRow[];
                    error: null;
                  }) => TResult1 | PromiseLike<TResult1>)
                | null,
            ) {
              const matched = applyUpdate();
              return Promise.resolve({ data: matched, error: null }).then(
                onfulfilled,
              );
            },
          };
          return builder;
        },
        delete() {
          const filters: Filter[] = [];
          const applyDelete = () => {
            const matched = filterRows(rows, filters);
            const matchedSet = new Set(matched);
            const remaining = rows.filter((r) => !matchedSet.has(r));
            rows.splice(0, rows.length, ...remaining);
            return matched;
          };
          const builder = {
            eq(col: string, val: unknown) {
              filters.push({ col, val, op: "eq" });
              return builder;
            },
            then<TResult1 = { data: InMemoryHandleRow[]; error: null }>(
              onfulfilled?:
                | ((value: {
                    data: InMemoryHandleRow[];
                    error: null;
                  }) => TResult1 | PromiseLike<TResult1>)
                | null,
            ) {
              const matched = applyDelete();
              return Promise.resolve({ data: matched, error: null }).then(
                onfulfilled,
              );
            },
          };
          return builder;
        },
      };
    },
  };
}

vi.mock("@/lib/auth/guards", () => ({
  hasSupabaseEnv: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createInMemorySupabase(activeDb),
}));

import {
  GET as listHandles,
  POST as createHandle,
} from "@/app/api/settings/settlement-handles/route";
import {
  PATCH as updateHandle,
  DELETE as deleteHandle,
} from "@/app/api/settings/settlement-handles/[handleId]/route";

describe("Settlement Handles CRUD API & Single-Default Invariant", () => {
  beforeEach(() => {
    idCounter = 10;
    activeDb = {
      settlement_handles: [
        {
          id: "sh-venmo",
          user_id: "u-jordan",
          provider: "VENMO",
          handle: "@jordan-davis",
          display_note: "Personal Venmo",
          is_default: true,
          created_at: "2026-11-01T10:00:00.000Z",
          updated_at: "2026-11-01T10:00:00.000Z",
        },
        {
          id: "sh-zelle",
          user_id: "u-jordan",
          provider: "ZELLE",
          handle: "+1 (415) 890-3412",
          display_note: null,
          is_default: false,
          created_at: "2026-11-02T10:00:00.000Z",
          updated_at: "2026-11-02T10:00:00.000Z",
        },
        {
          id: "sh-other-user",
          user_id: "u-elena",
          provider: "VENMO",
          handle: "@elena-r",
          display_note: "Elena Venmo",
          is_default: true,
          created_at: "2026-11-01T10:00:00.000Z",
          updated_at: "2026-11-01T10:00:00.000Z",
        },
      ],
    };

    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "u-jordan",
          email: "jordan.davis@fastmail.com",
        },
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests with 401", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await listHandles();
    expect(res.status).toBe(401);
  });

  it("lists only the authenticated user's handles with the default handle first", async () => {
    const res = await listHandles();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      handles: Array<{ id: string; provider: string; isDefault: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.handles).toHaveLength(2);
    expect(body.handles[0]).toMatchObject({
      id: "sh-venmo",
      provider: "VENMO",
      isDefault: true,
    });
    expect(body.handles[1]).toMatchObject({
      id: "sh-zelle",
      provider: "ZELLE",
      isDefault: false,
    });
  });

  it("creates a Cash App handle with is_default=true and atomically clears prior default for that user only", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/settings/settlement-handles",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "CASH_APP",
          handle: "  $jordandavis  ",
          display_note: "  Main Cash App  ",
          is_default: true,
        }),
      },
    );

    const res = await createHandle(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      handle: {
        id: string;
        provider: string;
        handle: string;
        displayNote: string | null;
        isDefault: boolean;
      };
      handles: Array<{ id: string; isDefault: boolean }>;
    };

    expect(body.ok).toBe(true);
    expect(body.handle).toMatchObject({
      provider: "CASH_APP",
      handle: "$jordandavis",
      displayNote: "Main Cash App",
      isDefault: true,
    });

    // At most one default for u-jordan
    const jordanDefaults = activeDb.settlement_handles.filter(
      (h) => h.user_id === "u-jordan" && h.is_default,
    );
    expect(jordanDefaults).toHaveLength(1);
    expect(jordanDefaults[0]?.id).toBe(body.handle.id);

    // Other user's default handle is untouched
    const elenaHandle = activeDb.settlement_handles.find(
      (h) => h.id === "sh-other-user",
    );
    expect(elenaHandle?.is_default).toBe(true);
  });

  it("validates provider, handle, and is_default on POST", async () => {
    const badProvider = await createHandle(
      new NextRequest("http://localhost:3000/api/settings/settlement-handles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "PAYPAL", handle: "@jordan" }),
      }),
    );
    expect(badProvider.status).toBe(400);

    const emptyHandle = await createHandle(
      new NextRequest("http://localhost:3000/api/settings/settlement-handles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "VENMO", handle: "   " }),
      }),
    );
    expect(emptyHandle.status).toBe(400);

    const badDefaultFlag = await createHandle(
      new NextRequest("http://localhost:3000/api/settings/settlement-handles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ZELLE",
          handle: "+1 (415) 555-0199",
          is_default: "yes",
        }),
      }),
    );
    expect(badDefaultFlag.status).toBe(400);
  });

  it("updates a handle and atomically switches default via PATCH", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/settings/settlement-handles/sh-zelle",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: "jordan@fastmail.com",
          display_note: "Chase Zelle",
          is_default: true,
        }),
      },
    );

    const res = await updateHandle(req, {
      params: Promise.resolve({ handleId: "sh-zelle" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      handle: {
        id: string;
        handle: string;
        displayNote: string | null;
        isDefault: boolean;
      };
      handles: Array<{ id: string; isDefault: boolean }>;
    };

    expect(body.ok).toBe(true);
    expect(body.handle).toMatchObject({
      id: "sh-zelle",
      handle: "jordan@fastmail.com",
      displayNote: "Chase Zelle",
      isDefault: true,
    });

    const venmoRow = activeDb.settlement_handles.find(
      (h) => h.id === "sh-venmo",
    );
    const zelleRow = activeDb.settlement_handles.find(
      (h) => h.id === "sh-zelle",
    );
    expect(venmoRow?.is_default).toBe(false);
    expect(zelleRow?.is_default).toBe(true);
    expect(body.handles[0]?.id).toBe("sh-zelle");
  });

  it("returns 404 when patching or deleting another user's handle", async () => {
    const patchRes = await updateHandle(
      new NextRequest(
        "http://localhost:3000/api/settings/settlement-handles/sh-other-user",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_default: true }),
        },
      ),
      { params: Promise.resolve({ handleId: "sh-other-user" }) },
    );
    expect(patchRes.status).toBe(404);

    const deleteRes = await deleteHandle(
      new NextRequest(
        "http://localhost:3000/api/settings/settlement-handles/sh-other-user",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ handleId: "sh-other-user" }) },
    );
    expect(deleteRes.status).toBe(404);
  });

  it("deletes an owned handle via DELETE and returns remaining handles", async () => {
    const res = await deleteHandle(
      new NextRequest(
        "http://localhost:3000/api/settings/settlement-handles/sh-zelle",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ handleId: "sh-zelle" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      deletedId: string;
      handles: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.deletedId).toBe("sh-zelle");
    expect(body.handles.map((h) => h.id)).toEqual(["sh-venmo"]);
  });

  it("ships SQL trigger migration enforcing atomic single-default settlement handle per user", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../supabase/migrations/20261128000003_settlement_handle_default_atomicity.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.ensure_single_default_settlement_handle/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_settlement_handles_single_default/i,
    );
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF is_default ON public\.settlement_handles/i);
  });
});
