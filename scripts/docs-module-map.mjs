import fs from "node:fs";
import path from "node:path";
import { cruise } from "dependency-cruiser";
import extractDepcruiseConfig from "dependency-cruiser/config-utl/extract-depcruise-config";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import extractTsConfig from "dependency-cruiser/config-utl/extract-ts-config";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, ".dependency-cruiser.cjs");
const TSCONFIG_PATH = path.join(ROOT, "tsconfig.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "architecture", "module-map.md");

function asciiCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizePosix(p) {
  return p.replace(/\\/g, "/");
}

function getTopLevelModule(modulePath) {
  const normalized = normalizePosix(modulePath);
  if (!normalized.startsWith("src/")) return null;
  const rest = normalized.slice("src/".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return rest;
  return rest.slice(0, slashIdx);
}

function toMermaidId(moduleName) {
  return moduleName.replace(/[^A-Za-z0-9_]/g, "_");
}

async function main() {
  const ruleSet = await extractDepcruiseConfig(CONFIG_PATH);
  const cruiseOptions = await extractDepcruiseOptions(CONFIG_PATH);
  const tsConfig = extractTsConfig(TSCONFIG_PATH);

  const result = await cruise(
    ["src"],
    {
      ...cruiseOptions,
      validate: true,
      ruleSet,
    },
    cruiseOptions.enhancedResolveOptions,
    { tsConfig },
  );

  if (typeof result.output === "string") {
    throw new Error("Expected structured ICruiseResult from dependency-cruiser");
  }

  const cruiseData = result.output;
  const moduleStats = new Map();
  const edgeCounts = new Map();

  function ensureBucket(name) {
    if (!moduleStats.has(name)) {
      moduleStats.set(name, {
        name,
        fileCount: 0,
        internalDepCount: 0,
        outgoing: new Set(),
        incoming: new Set(),
      });
    }
    return moduleStats.get(name);
  }

  const sortedModules = [...cruiseData.modules].sort((a, b) =>
    asciiCompare(normalizePosix(a.source), normalizePosix(b.source)),
  );

  for (const mod of sortedModules) {
    const sourceBucket = getTopLevelModule(mod.source);
    if (!sourceBucket) continue;

    const bucket = ensureBucket(sourceBucket);
    bucket.fileCount += 1;

    for (const dep of mod.dependencies) {
      if (!dep.resolved) continue;
      const targetBucket = getTopLevelModule(dep.resolved);
      if (!targetBucket) continue;

      bucket.internalDepCount += 1;
      if (targetBucket !== sourceBucket) {
        ensureBucket(targetBucket);
        bucket.outgoing.add(targetBucket);
        moduleStats.get(targetBucket).incoming.add(sourceBucket);

        const edgeKey = `${sourceBucket}->${targetBucket}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
      }
    }
  }

  const sortedBuckets = Array.from(moduleStats.values()).sort((a, b) =>
    asciiCompare(a.name, b.name),
  );

  const sortedEdges = Array.from(edgeCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split("->");
      return { from, to, count };
    })
    .sort((a, b) => asciiCompare(a.from, b.from) || asciiCompare(a.to, b.to));

  const violations = (cruiseData.summary?.violations ?? [])
    .map((v) => ({
      severity: v.rule?.severity ?? "info",
      rule: v.rule?.name ?? "unknown",
      from: normalizePosix(v.from ?? ""),
      to: normalizePosix(v.to ?? ""),
      cycle: Array.isArray(v.cycle)
        ? v.cycle.map((c) => normalizePosix(c.name ?? String(c)))
        : [],
    }))
    .sort(
      (a, b) =>
        asciiCompare(a.severity, b.severity) ||
        asciiCompare(a.rule, b.rule) ||
        asciiCompare(a.from, b.from) ||
        asciiCompare(a.to, b.to),
    );

  const lines = [];
  lines.push("# Source Module Dependency Map");
  lines.push("");
  lines.push(
    "Deterministically generated from `src/` via `dependency-cruiser` (`npm run docs:module-map`).",
  );
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart LR");

  for (const bucket of sortedBuckets) {
    const id = toMermaidId(bucket.name);
    lines.push(`    ${id}["src/${bucket.name}"]`);
  }

  if (sortedEdges.length > 0) {
    lines.push("");
    for (const edge of sortedEdges) {
      lines.push(
        `    ${toMermaidId(edge.from)} -->|${edge.count}| ${toMermaidId(edge.to)}`,
      );
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("## Module Dependency Summary");
  lines.push("");
  lines.push(
    "| Module | Files | Internal Imports | Depends On | Depended By |",
  );
  lines.push("| --- | ---: | ---: | --- | --- |");

  for (const bucket of sortedBuckets) {
    const outList = Array.from(bucket.outgoing).sort(asciiCompare);
    const inList = Array.from(bucket.incoming).sort(asciiCompare);
    lines.push(
      `| \`src/${bucket.name}\` | ${bucket.fileCount} | ${bucket.internalDepCount} | ${outList.length ? outList.map((m) => `\`src/${m}\``).join(", ") : "-"} | ${inList.length ? inList.map((m) => `\`src/${m}\``).join(", ") : "-"} |`,
    );
  }

  lines.push("");
  lines.push("## Cross-Module Edges");
  lines.push("");
  lines.push("| From | To | Import Count |");
  lines.push("| --- | --- | ---: |");
  for (const edge of sortedEdges) {
    lines.push(`| \`src/${edge.from}\` | \`src/${edge.to}\` | ${edge.count} |`);
  }

  lines.push("");
  lines.push("## Dependency Cruiser Diagnostics");
  lines.push("");
  lines.push(
    `- **Cruised Modules:** ${sortedModules.length}`,
  );
  lines.push(
    `- **Errors:** ${cruiseData.summary?.error ?? 0}`,
  );
  lines.push(
    `- **Warnings:** ${cruiseData.summary?.warn ?? 0}`,
  );

  if (violations.length > 0) {
    lines.push("");
    lines.push("| Severity | Rule | From | To / Cycle |");
    lines.push("| --- | --- | --- | --- |");
    for (const v of violations) {
      const target =
        v.cycle.length > 0 ? v.cycle.map((c) => `\`${c}\``).join(" -> ") : `\`${v.to}\``;
      lines.push(
        `| \`${v.severity}\` | \`${v.rule}\` | \`${v.from}\` | ${target} |`,
      );
    }
  }

  lines.push("");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join("\n"), "utf8");

  console.log(
    `Generated ${path.relative(ROOT, OUTPUT_PATH).replace(/\\/g, "/")} (${sortedBuckets.length} top-level modules, ${sortedEdges.length} cross-module edges, ${cruiseData.summary?.error ?? 0} errors, ${cruiseData.summary?.warn ?? 0} warnings).`,
  );

  if ((cruiseData.summary?.error ?? 0) > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
