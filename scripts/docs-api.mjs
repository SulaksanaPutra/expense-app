import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src", "app", "api");
const OPENAPI_OUTPUT_PATH = path.join(ROOT, "docs", "architecture", "openapi.json");
const ROUTES_MD_OUTPUT_PATH = path.join(ROOT, "docs", "architecture", "api-routes.md");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const STATUS_DESCRIPTIONS = {
  200: "OK",
  201: "Created",
  204: "No Content",
  302: "Found",
  307: "Temporary Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

function asciiCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectRouteFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => asciiCompare(a.name, b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

function toOpenApiRouteInfo(filePath) {
  const relToApi = path.relative(API_DIR, path.dirname(filePath));
  const rawSegments = relToApi ? relToApi.split(path.sep) : [];

  const pathParams = [];
  const urlSegments = [];

  for (const seg of rawSegments) {
    // Skip Next.js App Router route groups like (internal)
    if (/^\([^)]+\)$/.test(seg)) continue;

    const optCatchAll = seg.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optCatchAll) {
      const paramName = optCatchAll[1];
      pathParams.push(paramName);
      urlSegments.push(`{${paramName}}`);
      continue;
    }

    const catchAll = seg.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) {
      const paramName = catchAll[1];
      pathParams.push(paramName);
      urlSegments.push(`{${paramName}}`);
      continue;
    }

    const dynamic = seg.match(/^\[(.+)\]$/);
    if (dynamic) {
      const paramName = dynamic[1];
      pathParams.push(paramName);
      urlSegments.push(`{${paramName}}`);
      continue;
    }

    urlSegments.push(seg);
  }

  const openApiPath = `/api${urlSegments.length ? "/" + urlSegments.join("/") : ""}`;
  const firstStaticSegment = urlSegments.find((s) => !s.startsWith("{")) ?? "api";

  return {
    openApiPath,
    pathParams,
    tag: firstStaticSegment,
    sourceRelative: path.relative(ROOT, filePath).replace(/\\/g, "/"),
  };
}

function hasExportModifier(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function extractLeadingJsDoc(node, sourceText) {
  // Check AST attached JSDoc first
  const jsDocs = ts.getJSDocCommentsAndTags(node);
  if (jsDocs && jsDocs.length > 0) {
    for (const doc of jsDocs) {
      if (ts.isJSDoc(doc)) {
        const rawComment =
          typeof doc.comment === "string"
            ? doc.comment
            : Array.isArray(doc.comment)
              ? doc.comment.map((c) => c.text).join("")
              : "";
        const cleaned = rawComment.trim();
        if (cleaned) {
          const lines = cleaned
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          return {
            summary: lines[0] || "",
            description: lines.length > 1 ? lines.join(" ") : undefined,
          };
        }
      }
    }
  }

  // Fallback to leading /** ... */ comment range immediately before node
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) || [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    const commentText = sourceText.slice(range.pos, range.end);
    if (commentText.startsWith("/**")) {
      const inner = commentText
        .slice(3, -2)
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\*\s?/, "").trim())
        .filter((line) => line && !line.startsWith("@"));
      if (inner.length > 0) {
        return {
          summary: inner[0],
          description: inner.length > 1 ? inner.join(" ") : undefined,
        };
      }
    }
  }

  return { summary: "", description: undefined };
}

function extractResponseStatuses(node, defaultMethod) {
  const statuses = new Set();

  function visit(child) {
    if (
      ts.isPropertyAssignment(child) &&
      ((ts.isIdentifier(child.name) && child.name.text === "status") ||
        (ts.isStringLiteral(child.name) && child.name.text === "status")) &&
      ts.isNumericLiteral(child.initializer)
    ) {
      const code = Number(child.initializer.text);
      if (code >= 100 && code <= 599) {
        statuses.add(code);
      }
    } else if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === "NextResponse"
    ) {
      const methodName = child.expression.name.text;
      if (methodName === "json" && child.arguments.length === 1) {
        statuses.add(200);
      } else if (methodName === "redirect" && child.arguments.length === 1) {
        statuses.add(307);
      }
    }
    ts.forEachChild(child, visit);
  }

  visit(node);

  if (statuses.size === 0) {
    statuses.add(defaultMethod === "POST" ? 201 : 200);
  }

  return Array.from(statuses).sort((a, b) => a - b);
}

function parseRouteFile(filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const handlers = new Map();

  for (const stmt of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      stmt.name &&
      HTTP_METHODS.includes(stmt.name.text)
    ) {
      const method = stmt.name.text;
      const jsdoc = extractLeadingJsDoc(stmt, sourceText);
      const statuses = extractResponseStatuses(stmt, method);
      handlers.set(method, { method, ...jsdoc, statuses });
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      const jsdoc = extractLeadingJsDoc(stmt, sourceText);
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && HTTP_METHODS.includes(decl.name.text)) {
          const method = decl.name.text;
          const statuses = extractResponseStatuses(decl, method);
          handlers.set(method, { method, ...jsdoc, statuses });
        }
      }
    }
  }

  return HTTP_METHODS.filter((m) => handlers.has(m)).map((m) => handlers.get(m));
}

function buildOperationId(method, openApiPath) {
  const slug = openApiPath
    .replace(/^\/api\/?/, "")
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, "_"))
    .join("_");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const routeFiles = collectRouteFiles(API_DIR);

  const routeEntries = routeFiles
    .map((filePath) => ({
      ...toOpenApiRouteInfo(filePath),
      handlers: parseRouteFile(filePath),
    }))
    .filter((entry) => entry.handlers.length > 0)
    .sort((a, b) => asciiCompare(a.openApiPath, b.openApiPath));

  const pathsObject = {};
  const markdownRows = [];

  for (const entry of routeEntries) {
    const pathItem = {};
    if (entry.pathParams.length > 0) {
      pathItem.parameters = entry.pathParams.map((param) => ({
        name: param,
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    }

    for (const handler of entry.handlers) {
      const summary = handler.summary || `${handler.method} ${entry.openApiPath}`;
      const responses = {};
      for (const code of handler.statuses) {
        responses[String(code)] = {
          description: STATUS_DESCRIPTIONS[code] || `HTTP ${code}`,
        };
      }

      const operation = {
        operationId: buildOperationId(handler.method, entry.openApiPath),
        tags: [entry.tag],
        summary,
        ...(handler.description ? { description: handler.description } : {}),
        responses,
      };

      pathItem[handler.method.toLowerCase()] = operation;

      markdownRows.push({
        path: entry.openApiPath,
        method: handler.method,
        tag: entry.tag,
        params: entry.pathParams.map((p) => `\`${p}\``).join(", ") || "-",
        statuses: handler.statuses.join(", "),
        summary: summary.replace(/\|/g, "\\|"),
        source: entry.sourceRelative,
      });
    }

    pathsObject[entry.openApiPath] = pathItem;
  }

  const openApiDoc = {
    openapi: "3.1.0",
    info: {
      title: "LedgerSplit API",
      version: pkg.version || "0.1.0",
      description:
        "Deterministic OpenAPI specification generated from src/app/api/**/route.ts.",
    },
    paths: pathsObject,
  };

  const mdLines = [
    "# API Routes Reference",
    "",
    "Deterministically generated from `src/app/api/**/route.ts` via `npm run docs:api`.",
    "",
    `- **OpenAPI Spec:** [\`docs/architecture/openapi.json\`](./openapi.json)`,
    `- **Total Endpoints:** ${markdownRows.length} operations across ${routeEntries.length} paths`,
    "",
    "| Path | Method | Tag | Path Params | Status Codes | Summary | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of markdownRows) {
    mdLines.push(
      `| \`${row.path}\` | \`${row.method}\` | \`${row.tag}\` | ${row.params} | ${row.statuses} | ${row.summary} | \`${row.source}\` |`,
    );
  }
  mdLines.push("");

  fs.mkdirSync(path.dirname(OPENAPI_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OPENAPI_OUTPUT_PATH,
    JSON.stringify(openApiDoc, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(ROUTES_MD_OUTPUT_PATH, mdLines.join("\n"), "utf8");

  console.log(
    `Generated ${path.relative(ROOT, OPENAPI_OUTPUT_PATH).replace(/\\/g, "/")} and ${path.relative(ROOT, ROUTES_MD_OUTPUT_PATH).replace(/\\/g, "/")} (${markdownRows.length} operations across ${routeEntries.length} paths).`,
  );
}

main();
