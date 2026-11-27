import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function resolveWorktreeTurbopackRoot(): string | undefined {
  try {
    const cwd = process.cwd();
    const nmPath = path.join(cwd, "node_modules");
    const realNm = fs.realpathSync(nmPath);
    const nmParent = path.dirname(realNm);
    if (nmParent !== cwd && cwd.startsWith(nmParent)) {
      return nmParent;
    }
  } catch {
    // Ignore when node_modules is absent or standard.
  }
  return undefined;
}

const turbopackRoot = resolveWorktreeTurbopackRoot();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
};

export default nextConfig;
