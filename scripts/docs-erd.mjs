import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const OUTPUT_PATH = path.join(ROOT, "docs", "architecture", "erd.md");

function asciiCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Strip SQL comments (-- and nested /* ... *\/) and dollar-quoted function/DO blocks
 * while preserving single-quoted string literals and double-quoted identifiers.
 */
function preprocessSql(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Single-line comment
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") {
        i++;
      }
      out += "\n";
      continue;
    }

    // Block comment (Postgres allows nesting)
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
      continue;
    }

    // Single-quoted string literal
    if (ch === "'") {
      let lit = "'";
      i++;
      while (i < n) {
        lit += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            lit += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += lit;
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      let ident = '"';
      i++;
      while (i < n) {
        ident += sql[i];
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            ident += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += ident;
      continue;
    }

    // Dollar-quoted block ($tag$...$tag$)
    if (ch === "$") {
      const tagMatch = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIdx = sql.indexOf(tag, i + tag.length);
        if (endIdx !== -1) {
          i = endIdx + tag.length;
          out += "''";
          continue;
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Split SQL into top-level semicolon-delimited statements.
 */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inDouble = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
    } else if (ch === '"') {
      inDouble = true;
      current += ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      if (depth > 0) depth--;
      current += ch;
    } else if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * Split comma-separated items at parenthesis depth 0.
 */
function splitTopLevelCommas(text) {
  const items = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inDouble = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
    } else if (ch === '"') {
      inDouble = true;
      current += ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      if (depth > 0) depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) items.push(tail);
  return items;
}

function unquoteIdent(ident) {
  const trimmed = ident.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').toLowerCase();
  }
  return trimmed.toLowerCase();
}

function parseQualifiedName(raw) {
  const cleaned = raw.trim();
  const dotIdx = cleaned.indexOf(".");
  if (dotIdx === -1) {
    return { schema: "public", name: unquoteIdent(cleaned) };
  }
  return {
    schema: unquoteIdent(cleaned.slice(0, dotIdx)),
    name: unquoteIdent(cleaned.slice(dotIdx + 1)),
  };
}

function extractBalancedParens(str, openIdx) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (inSingle) {
      if (ch === "'") {
        if (str[i + 1] === "'") i++;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        if (str[i + 1] === '"') i++;
        else inDouble = false;
      }
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { content: str.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
}

function normalizeMermaidType(rawType) {
  const collapsed = rawType
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (collapsed.startsWith("character varying")) return "varchar";
  if (collapsed.startsWith("varchar")) return "varchar";
  if (collapsed.startsWith("numeric") || collapsed.startsWith("decimal")) {
    return "numeric";
  }
  if (collapsed.startsWith("timestamp with time zone")) return "timestamptz";
  if (collapsed.startsWith("timestamp without time zone")) return "timestamp";
  if (collapsed.startsWith("time with time zone")) return "timetz";
  if (collapsed.startsWith("time without time zone")) return "time";
  if (collapsed.startsWith("double precision")) return "double_precision";
  if (collapsed.startsWith("bit varying")) return "varbit";

  return collapsed
    .replace(/\([^)]*\)/g, "")
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

const CONSTRAINT_START_RE =
  /^(NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|DEFAULT|CONSTRAINT|CHECK|UNIQUE|GENERATED|COLLATE|AS)\b/i;

function parseColumnDefinition(defText) {
  const trimmed = defText.trim();
  const identMatch = trimmed.match(/^("([^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\s+([\s\S]+)$/);
  if (!identMatch) return null;

  const colName = unquoteIdent(identMatch[1]);
  let rest = identMatch[3].trim();

  // Extract SQL data type up to the first column constraint keyword
  let typeTokens = "";
  while (rest.length > 0) {
    if (CONSTRAINT_START_RE.test(rest)) {
      break;
    }
    if (rest.startsWith("(")) {
      const parens = extractBalancedParens(rest, 0);
      if (!parens) break;
      typeTokens += `(${parens.content})`;
      rest = rest.slice(parens.endIdx + 1).trim();
      continue;
    }
    const tokenMatch = rest.match(/^([^\s(]+)\s*([\s\S]*)$/);
    if (!tokenMatch) break;
    typeTokens += (typeTokens ? " " : "") + tokenMatch[1];
    rest = tokenMatch[2].trim();
  }

  const sqlType = typeTokens.replace(/\s+/g, " ").trim().toUpperCase();
  const mermaidType = normalizeMermaidType(typeTokens);

  const isPk = /\bPRIMARY\s+KEY\b/i.test(rest);
  const notNull = isPk || /\bNOT\s+NULL\b/i.test(rest);

  const refs = [];
  const refRegex =
    /\bREFERENCES\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)(?:\s*\(([^)]+)\))?/gi;
  let refMatch;
  while ((refMatch = refRegex.exec(rest)) !== null) {
    const target = parseQualifiedName(refMatch[1]);
    const targetCol = refMatch[2]
      ? unquoteIdent(refMatch[2].split(",")[0])
      : "id";
    refs.push({
      toSchema: target.schema,
      toTable: target.name,
      toCol: targetCol,
    });
  }

  return {
    name: colName,
    sqlType,
    mermaidType,
    isPk,
    isFk: refs.length > 0,
    notNull,
    refs,
  };
}

function ensureTable(schemaMap, schema, name) {
  const key = `${schema}.${name}`;
  if (!schemaMap.has(key)) {
    schemaMap.set(key, {
      schema,
      name,
      columns: new Map(),
      relations: [],
    });
  }
  return schemaMap.get(key);
}

function applyColumn(table, col) {
  const existing = table.columns.get(col.name);
  if (existing) {
    existing.sqlType = col.sqlType || existing.sqlType;
    existing.mermaidType = col.mermaidType || existing.mermaidType;
    existing.isPk = existing.isPk || col.isPk;
    existing.isFk = existing.isFk || col.isFk;
    existing.notNull = existing.notNull || col.notNull;
  } else {
    table.columns.set(col.name, {
      name: col.name,
      sqlType: col.sqlType,
      mermaidType: col.mermaidType,
      isPk: col.isPk,
      isFk: col.isFk,
      notNull: col.notNull,
    });
  }

  for (const ref of col.refs) {
    table.relations.push({
      fromSchema: table.schema,
      fromTable: table.name,
      fromCol: col.name,
      toSchema: ref.toSchema,
      toTable: ref.toTable,
      toCol: ref.toCol,
      notNull: col.notNull,
    });
  }
}

function parseCreateTable(stmt, tables) {
  const match = stmt.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)\s*\(/i,
  );
  if (!match) return;

  const { schema, name } = parseQualifiedName(match[1]);
  const openParenIdx = stmt.indexOf("(", match[0].length - 1);
  const parens = extractBalancedParens(stmt, openParenIdx);
  if (!parens) return;

  const table = ensureTable(tables, schema, name);
  const items = splitTopLevelCommas(parens.content);

  for (const item of items) {
    // Table-level PRIMARY KEY
    const pkMatch = item.match(
      /^(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i,
    );
    if (pkMatch) {
      const pkCols = pkMatch[1].split(",").map(unquoteIdent);
      for (const pkCol of pkCols) {
        const col = table.columns.get(pkCol);
        if (col) {
          col.isPk = true;
          col.notNull = true;
        }
      }
      continue;
    }

    // Table-level FOREIGN KEY
    const fkMatch = item.match(
      /^(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)(?:\s*\(([^)]+)\))?/i,
    );
    if (fkMatch) {
      const localCols = fkMatch[1].split(",").map(unquoteIdent);
      const target = parseQualifiedName(fkMatch[2]);
      const targetCols = fkMatch[3]
        ? fkMatch[3].split(",").map(unquoteIdent)
        : ["id"];
      localCols.forEach((localCol, idx) => {
        const col = table.columns.get(localCol);
        if (col) col.isFk = true;
        table.relations.push({
          fromSchema: table.schema,
          fromTable: table.name,
          fromCol: localCol,
          toSchema: target.schema,
          toTable: target.name,
          toCol: targetCols[idx] || targetCols[0] || "id",
          notNull: col ? col.notNull : false,
        });
      });
      continue;
    }

    // Other table-level constraints
    if (/^(CONSTRAINT|CHECK|UNIQUE|EXCLUDE)\b/i.test(item)) {
      continue;
    }

    const col = parseColumnDefinition(item);
    if (col) {
      applyColumn(table, col);
    }
  }
}

function parseAlterTable(stmt, tables) {
  const match = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)\s+([\s\S]+)$/i,
  );
  if (!match) return;

  const { schema, name } = parseQualifiedName(match[1]);
  const tableKey = `${schema}.${name}`;
  const table = tables.get(tableKey);
  if (!table) return;

  const actions = splitTopLevelCommas(match[2]);
  for (const action of actions) {
    const addColMatch = action.match(
      /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i,
    );
    if (
      addColMatch &&
      !/^CONSTRAINT\b|^PRIMARY\s+KEY\b|^FOREIGN\s+KEY\b|^UNIQUE\b|^CHECK\b|^EXCLUDE\b/i.test(
        addColMatch[1].trim(),
      )
    ) {
      const col = parseColumnDefinition(addColMatch[1]);
      if (col) applyColumn(table, col);
      continue;
    }

    const addPkMatch = action.match(
      /^ADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i,
    );
    if (addPkMatch) {
      for (const pkCol of addPkMatch[1].split(",").map(unquoteIdent)) {
        const col = table.columns.get(pkCol);
        if (col) {
          col.isPk = true;
          col.notNull = true;
        }
      }
      continue;
    }

    const addFkMatch = action.match(
      /^ADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)(?:\s*\(([^)]+)\))?/i,
    );
    if (addFkMatch) {
      const localCols = addFkMatch[1].split(",").map(unquoteIdent);
      const target = parseQualifiedName(addFkMatch[2]);
      const targetCols = addFkMatch[3]
        ? addFkMatch[3].split(",").map(unquoteIdent)
        : ["id"];
      localCols.forEach((localCol, idx) => {
        const col = table.columns.get(localCol);
        if (col) col.isFk = true;
        table.relations.push({
          fromSchema: table.schema,
          fromTable: table.name,
          fromCol: localCol,
          toSchema: target.schema,
          toTable: target.name,
          toCol: targetCols[idx] || targetCols[0] || "id",
          notNull: col ? col.notNull : false,
        });
      });
      continue;
    }

    const dropColMatch = action.match(
      /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s+(?:CASCADE|RESTRICT))?$/i,
    );
    if (dropColMatch) {
      const colName = unquoteIdent(dropColMatch[1]);
      table.columns.delete(colName);
      table.relations = table.relations.filter((r) => r.fromCol !== colName);
    }
  }
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(asciiCompare);

  const tables = new Map();

  for (const file of migrationFiles) {
    const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const cleaned = preprocessSql(rawSql);
    const statements = splitStatements(cleaned);

    for (const stmt of statements) {
      if (/^CREATE\s+TABLE\b/i.test(stmt)) {
        parseCreateTable(stmt, tables);
      } else if (/^ALTER\s+TABLE\b/i.test(stmt)) {
        parseAlterTable(stmt, tables);
      }
    }
  }

  const sortedTables = Array.from(tables.values()).sort((a, b) =>
    asciiCompare(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`),
  );

  const internalRelations = [];
  const externalRelations = [];
  const seenRelKeys = new Set();

  for (const table of sortedTables) {
    for (const rel of table.relations) {
      const relKey = `${rel.fromSchema}.${rel.fromTable}.${rel.fromCol}->${rel.toSchema}.${rel.toTable}.${rel.toCol}`;
      if (seenRelKeys.has(relKey)) continue;
      seenRelKeys.add(relKey);

      const targetKey = `${rel.toSchema}.${rel.toTable}`;
      if (tables.has(targetKey)) {
        internalRelations.push(rel);
      } else {
        externalRelations.push(rel);
      }
    }
  }

  internalRelations.sort(
    (a, b) =>
      asciiCompare(a.toTable, b.toTable) ||
      asciiCompare(a.fromTable, b.fromTable) ||
      asciiCompare(a.fromCol, b.fromCol),
  );

  externalRelations.sort(
    (a, b) =>
      asciiCompare(a.fromTable, b.fromTable) ||
      asciiCompare(a.fromCol, b.fromCol) ||
      asciiCompare(`${a.toSchema}.${a.toTable}`, `${b.toSchema}.${b.toTable}`),
  );

  const lines = [];
  lines.push("# Entity-Relationship Diagram (ERD)");
  lines.push("");
  lines.push(
    "Deterministically generated from `supabase/migrations/*.sql` via `npm run docs:erd`.",
  );
  lines.push("");
  lines.push("```mermaid");
  lines.push("erDiagram");

  for (const table of sortedTables) {
    lines.push(`    ${table.name} {`);
    const cols = Array.from(table.columns.values()).sort((a, b) => {
      if (a.isPk !== b.isPk) return a.isPk ? -1 : 1;
      return asciiCompare(a.name, b.name);
    });
    for (const col of cols) {
      const keys = [];
      if (col.isPk) keys.push("PK");
      if (col.isFk) keys.push("FK");
      const keySuffix = keys.length > 0 ? ` ${keys.join(",")}` : "";
      lines.push(`        ${col.mermaidType} ${col.name}${keySuffix}`);
    }
    lines.push("    }");
  }

  if (internalRelations.length > 0) {
    lines.push("");
    for (const rel of internalRelations) {
      const cardinality = rel.notNull ? "||--o{" : "|o--o{";
      lines.push(
        `    ${rel.toTable} ${cardinality} ${rel.fromTable} : "${rel.fromCol}"`,
      );
    }
  }

  lines.push("```");
  lines.push("");

  lines.push("## Tables Summary");
  lines.push("");
  lines.push("| Table | Schema | Columns | Primary Key | Foreign Keys |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const table of sortedTables) {
    const cols = Array.from(table.columns.values()).sort((a, b) =>
      asciiCompare(a.name, b.name),
    );
    const pks = cols.filter((c) => c.isPk).map((c) => `\`${c.name}\``);
    const fks = cols.filter((c) => c.isFk).map((c) => `\`${c.name}\``);
    lines.push(
      `| \`${table.name}\` | \`${table.schema}\` | ${cols.length} | ${pks.length ? pks.join(", ") : "-"} | ${fks.length ? fks.join(", ") : "-"} |`,
    );
  }

  if (externalRelations.length > 0) {
    lines.push("");
    lines.push("## External Schema References");
    lines.push("");
    for (const rel of externalRelations) {
      lines.push(
        `- \`${rel.fromSchema}.${rel.fromTable}.${rel.fromCol}\` -> \`${rel.toSchema}.${rel.toTable}.${rel.toCol}\``,
      );
    }
  }

  lines.push("");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join("\n"), "utf8");
  console.log(
    `Generated ${path.relative(ROOT, OUTPUT_PATH).replace(/\\/g, "/")} (${sortedTables.length} tables, ${internalRelations.length} relations from ${migrationFiles.length} migrations).`,
  );
}

main();
