import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const nodeModulesPath = path.join(process.cwd(), "node_modules");
let turbopackRoot: string | undefined;
try {
  if (fs.lstatSync(nodeModulesPath).isSymbolicLink()) {
    turbopackRoot = path.dirname(fs.realpathSync(nodeModulesPath));
  }
} catch {
  // Ignore if node_modules is absent during static config checks
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
};

export default nextConfig;
