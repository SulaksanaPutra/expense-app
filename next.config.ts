import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function resolveWorktreeTurbopackRoot(): string | undefined {
  try {
    const nmPath = path.join(process.cwd(), "node_modules");
    if (fs.lstatSync(nmPath).isSymbolicLink()) {
      return path.dirname(fs.realpathSync(nmPath));
    }
  } catch {
    // Ignore when node_modules is absent or inaccessible
  }
  return undefined;
}

const turbopackRoot = resolveWorktreeTurbopackRoot();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
};

export default nextConfig;
