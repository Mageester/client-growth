import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PARSER_VERSION = "1.0.0";
const PROJECT_PATH = /^(?:src|app|workers)\/.+/;
const PATH_COMMENT = /^(?:(?:src|app|workers)\/.+|[A-Za-z0-9_.-]+\/.+\.(?:js|mjs|cjs|ts|tsx|jsx|css))$/;

function createState() {
  return { template: false, blockComment: false };
}

function advanceLexicalState(line, state) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (state.blockComment) {
      if (character === "*" && next === "/") {
        state.blockComment = false;
        index += 1;
      }
      continue;
    }
    if (state.template) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "`") {
        state.template = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "`") {
      state.template = true;
      continue;
    }
    if (character === "/" && next === "*") {
      state.blockComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") break;
  }
}

function boundaryPath(line, state) {
  if (state.template || state.blockComment) return null;
  const candidate = line.match(/^\s*\/\/\s+([^\s]+)\s*$/)?.[1] ?? null;
  return candidate && PATH_COMMENT.test(candidate) ? candidate : null;
}

function collectMatches(text, expression) {
  const values = [];
  for (const match of text.matchAll(expression)) values.push(match[1]);
  return [...new Set(values)];
}

function delimiterBalance(text) {
  const stack = [];
  const pairs = { "{": "}", "[": "]", "(": ")" };
  const closing = new Set(Object.values(pairs));
  let quote = null;
  let template = false;
  let blockComment = false;
  let escaped = false;
  let mismatches = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (template) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "`") template = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === "`") { template = true; continue; }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (character === "/" && next === "/") { const newline = text.indexOf("\n", index); index = newline === -1 ? text.length : newline; continue; }
    if (pairs[character]) { stack.push(pairs[character]); continue; }
    if (closing.has(character)) {
      if (stack.pop() !== character) mismatches += 1;
    }
  }
  return { balanced: mismatches === 0 && stack.length === 0, mismatches, remaining: stack.length };
}

function regionMetadata(text) {
  const symbols = [
    ...collectMatches(text, /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g),
    ...collectMatches(text, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g),
    ...collectMatches(text, /\bexport\s+(?:default\s+)?(?:function|class|const|let|var)?\s*([A-Za-z_$][\w$]*)/g),
  ];
  const imports = collectMatches(text, /\bfrom\s+["']([^"']+)["']/g)
    .concat(collectMatches(text, /\bimport\s*["']([^"']+)["']/g));
  const routes = collectMatches(text, /["'](\/[^"'\s]{1,160})["']/g);
  const environmentKeys = [...new Set(text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])];
  const sql = [...new Set((text.match(/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b[^;]{0,300}/gi) ?? []).map((value) => value.trim()))];
  const stringLiterals = [];
  for (const match of text.matchAll(/["']([^"'\n]{1,160})["']/g)) {
    const value = match[1];
    if (/^(?:https?:\/\/|\/|[A-Za-z0-9_.@-]+$)/.test(value) || /[A-Z_]{3,}/.test(value)) stringLiterals.push(value);
  }
  return {
    symbols: [...new Set(symbols)],
    imports: [...new Set(imports)],
    routes: [...new Set(routes)],
    environmentKeys,
    sql,
    stringLiterals: [...new Set(stringLiterals)],
  };
}

export function parseBundle(source) {
  const lines = source.split("\n");
  const boundaries = [];
  const rejectedComments = [];
  const state = createState();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidate = line.match(/^\s*\/\/\s+([^\s]+)\s*$/)?.[1] ?? null;
    const pathValue = boundaryPath(line, state);
    if (pathValue) {
      boundaries.push({ path: pathValue, line: index + 1, projectOwned: PROJECT_PATH.test(pathValue) });
    } else if (candidate && PATH_COMMENT.test(candidate) && (state.template || state.blockComment)) {
      rejectedComments.push({ line: index + 1, candidate, reason: state.template ? "inside-template" : "inside-block-comment" });
    }
    advanceLexicalState(line, state);
  }
  const regions = boundaries.map((boundary, index) => {
    const endLine = (boundaries[index + 1]?.line ?? lines.length + 1) - 1;
    const text = lines.slice(boundary.line - 1, endLine).join("\n");
    return {
      path: boundary.path,
      projectOwned: boundary.projectOwned,
      startLine: boundary.line,
      endLine,
      lineCount: endLine - boundary.line + 1,
      textSha256: crypto.createHash("sha256").update(text).digest("hex"),
      normalizedTextSha256: crypto.createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex"),
      delimiterBalance: delimiterBalance(text),
      ...regionMetadata(text),
    };
  });
  return { parserVersion: PARSER_VERSION, lineCount: lines.length, regions, rejectedComments };
}

function markdownIndex(index, inputHash) {
  const rows = [
    "# Production bundle module index",
    "",
    `- Input SHA-256: \`${inputHash}\``,
    `- Parser version: \`${index.parserVersion}\``,
    `- Input lines: ${index.lineCount}`,
    `- Regions: ${index.regions.length}`,
    `- Project-owned regions: ${index.regions.filter((region) => region.projectOwned).length}`,
    `- Rejected boundary comments: ${index.rejectedComments.length}`,
    "",
    "| Start | End | Project-owned | Balanced | Original path | Symbols | Imports | SQL/literals |",
    "| ---: | ---: | :---: | :---: | --- | --- | --- | --- |",
  ];
  for (const region of index.regions) {
    rows.push(`| ${region.startLine} | ${region.endLine} | ${region.projectOwned ? "yes" : "no"} | ${region.delimiterBalance.balanced ? "yes" : "no"} | \`${region.path}\` | ${region.symbols.slice(0, 12).join(", ")} | ${region.imports.slice(0, 8).join(", ")} | ${region.sql.length}/${region.stringLiterals.length} |`);
  }
  if (index.rejectedComments.length > 0) {
    rows.push("", "## Rejected boundary candidates", "", "| Line | Candidate | Reason |", "| ---: | --- | --- |");
    for (const rejected of index.rejectedComments) rows.push(`| ${rejected.line} | \`${rejected.candidate}\` | ${rejected.reason} |`);
  }
  const unbalanced = index.regions.filter((region) => !region.delimiterBalance.balanced);
  if (unbalanced.length > 0) {
    rows.push("", "## Delimiter diagnostics", "", "These regions are emitted bundle regions, not standalone source files; an unbalanced result is retained as a diagnostic and is not used to discard the boundary.", "", "| Start | End | Original path | Mismatches | Remaining |", "| ---: | ---: | --- | ---: | ---: |");
    for (const region of unbalanced) rows.push(`| ${region.startLine} | ${region.endLine} | \`${region.path}\` | ${region.delimiterBalance.mismatches} | ${region.delimiterBalance.remaining} |`);
  }
  return `${rows.join("\n")}\n`;
}

export async function indexBundle(inputPath, outputRoot) {
  const source = await fs.readFile(inputPath, "utf8");
  const inputHash = crypto.createHash("sha256").update(source).digest("hex");
  const index = { inputPath, inputHash, generatedAt: new Date().toISOString(), ...parseBundle(source) };
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, "module-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputRoot, "module-index.md"), markdownIndex(index, inputHash), "utf8");
  const literals = index.regions.filter((region) => region.projectOwned).map((region) => ({ path: region.path, startLine: region.startLine, endLine: region.endLine, environmentKeys: region.environmentKeys, routes: region.routes, sql: region.sql, stringLiterals: region.stringLiterals }));
  await fs.writeFile(path.join(outputRoot, "production-literals.json"), `${JSON.stringify({ inputHash, literals }, null, 2)}\n`, "utf8");
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const inputPath = process.argv[2] ?? path.resolve("recovery/evidence/known/extracted/app.js");
  const outputRoot = process.argv[3] ?? path.resolve("recovery/bundle");
  const index = await indexBundle(inputPath, outputRoot);
  console.log(JSON.stringify({ inputHash: index.inputHash, regions: index.regions.length, projectOwned: index.regions.filter((region) => region.projectOwned).length, rejectedComments: index.rejectedComments.length }, null, 2));
}
