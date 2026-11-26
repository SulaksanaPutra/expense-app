import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseEnv } from "../src/lib/supabase/env";

const ROOT = path.resolve(__dirname, "..");

describe("Supabase Client Helpers & Environment Contract", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
    }
  });

  it("throws descriptive error when Supabase env vars are missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => getSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("returns configured Supabase env vars when present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    expect(getSupabaseEnv()).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key-123",
    });
  });

  it("provides browser, server, middleware helpers and .env.example", () => {
    const expectedFiles = [
      "src/lib/supabase/client.ts",
      "src/lib/supabase/server.ts",
      "src/lib/supabase/middleware.ts",
      "src/proxy.ts",
      "src/types/database.ts",
      ".env.example",
    ];
    for (const rel of expectedFiles) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} must exist`).toBe(
        true,
      );
    }

    const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_URL=");
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY=");
    expect(envExample).toContain("SUPABASE_SERVICE_ROLE_KEY=");
  });
});
