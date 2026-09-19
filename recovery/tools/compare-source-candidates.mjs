import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionMetadata } from "./index-bundle.mjs";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function setOverlap(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((value) => actualSet.has(value)).length;
}

export function scoreCandidate(region, candidate) {
  const features = regionMetadata(candidate.source);
  const overlap = {
    symbols: setOverlap(region.symbols ?? [], features.symbols),
    imports: setOverlap(region.imports ?? [], features.imports),
    routes: setOverlap(region.routes ?? [], features.routes),
    environmentKeys: setOverlap(region.environmentKeys ?? [], features.environmentKeys),
    sql: setOverlap(region.sql ?? [], features.sql),
    stringLiterals: setOverlap(region.stringLiterals ?? [], features.stringLiterals),
  };
  const ratios = {
    symbols: (region.symbols?.length ?? 0) ? overlap.symbols / region.symbols.length : 0,
    imports: (region.imports?.length ?? 0) ? overlap.imports / region.imports.length : 0,
    routes: (region.routes?.length ?? 0) ? overlap.routes / region.routes.length : 0,
    environmentKeys: (region.environmentKeys?.length ?? 0) ? overlap.environmentKeys / region.environmentKeys.length : 0,
    sql: (region.sql?.length ?? 0) ? overlap.sql / region.sql.length : 0,
    stringLiterals: (region.stringLiterals?.length ?? 0) ? overlap.stringLiterals / region.stringLiterals.length : 0,
  };
  const pathMatch = region.path === candidate.path;
  const score = (pathMatch ? 40 : 0)
    + ratios.symbols * 25
    + ratios.imports * 10
    + ratios.routes * 5
    + ratios.environmentKeys * 5
    + ratios.sql * 10
    + ratios.stringLiterals * 5;
  return { pathMatch, score: Number(score.toFixed(4)), overlap, ratios, candidateSha256: crypto.createHash("sha256").update(candidate.source).digest("hex") };
}

function confidenceFor(score, hasCandidate) {
  if (!hasCandidate) return "UNRESOLVED";
  if (score >= 85) return "HIGH-CONFIDENCE RECONSTRUCTION";
  if (score >= 55) return "MEDIUM-CONFIDENCE RECONSTRUCTION";
  return "UNRESOLVED";
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function matrixMarkdown(rows, branchSummary, inputHash) {
  const lines = [
    "# Production recovery matrix",
    "",
    `- Bundle index input SHA-256: \`${inputHash}\``,
    `- Project-owned production regions: ${rows.length}`,
    `- Main-present regions: ${rows.filter((row) => row.mainState === "present").length}`,
    `- Main-missing regions: ${rows.filter((row) => row.mainState === "missing").length}`,
    "- Exact source recovery from GitHub/source maps: none established at this stage; branch candidates are source skeletons pending semantic comparison.",
    "- Candidate score weights: exact path 40, symbols 25, imports 10, routes 5, environment keys 5, SQL 10, meaningful strings 5.",
    "",
    "| Production module | Main state | Best branch/source | Confidence | Action required |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) lines.push(`| \`${row.productionModule}\` | ${row.mainState} | ${escapeCell(row.bestBranchSource)} | ${row.confidence} | ${escapeCell(row.actionRequired)} |`);
  lines.push("", "## Branch aggregate overlap", "", "| Branch refs | Unique tip | Candidate regions | Mean score |", "| --- | --- | ---: | ---: |");
  for (const row of branchSummary) lines.push(`| ${escapeCell(row.refs.join(", "))} | \`${row.tip}\` | ${row.candidateRegions} | ${row.meanScore} |`);
  return `${lines.join("\n")}\n`;
}

export async function compareSourceCandidates(repoRoot, indexPath, outputRoot, matrixPath) {
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const refs = git(repoRoot, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/github"])
    .trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [ref, tip] = line.split(" ");
      return { ref, tip };
    });
  const uniqueTips = new Map();
  for (const item of refs) {
    const existing = uniqueTips.get(item.tip);
    if (existing) existing.refs.push(item.ref);
    else uniqueTips.set(item.tip, { tip: item.tip, refs: [item.ref] });
  }
  const trees = new Map();
  for (const item of uniqueTips.values()) {
    const ref = item.refs[0];
    trees.set(item.tip, new Set(git(repoRoot, ["ls-tree", "-r", "--name-only", ref]).trim().split(/\r?\n/).filter(Boolean)));
  }
  const sourceCache = new Map();
  function readSource(ref, filePath) {
    const key = `${ref}:${filePath}`;
    if (sourceCache.has(key)) return sourceCache.get(key);
    try {
      const source = git(repoRoot, ["show", `${ref}:${filePath}`]);
      sourceCache.set(key, source);
      return source;
    } catch {
      sourceCache.set(key, null);
      return null;
    }
  }

  const rows = [];
  const moduleCandidates = [];
  for (const region of index.regions.filter((entry) => entry.projectOwned)) {
    const candidates = [];
    for (const item of uniqueTips.values()) {
      const ref = item.refs[0];
      if (!trees.get(item.tip).has(region.path)) continue;
      const source = readSource(ref, region.path);
      if (source === null) continue;
      const score = scoreCandidate(region, { path: region.path, source });
      candidates.push({ refs: item.refs, tip: item.tip, path: region.path, ...score });
    }
    candidates.sort((a, b) => b.score - a.score || a.tip.localeCompare(b.tip));
    const mainRef = "refs/remotes/github/main";
    const mainSource = trees.get(refs.find((item) => item.ref === mainRef)?.tip)?.has(region.path) ?? false;
    const best = candidates[0] ?? null;
    const confidence = confidenceFor(best?.score ?? 0, Boolean(best));
    const bestBranchSource = best ? `${best.refs.join(", ")} @ ${best.tip.slice(0, 12)}:${region.path}` : "No reachable GitHub source candidate";
    const actionRequired = !best
      ? "Reconstruct from production bundle and neighboring types"
      : mainSource && best.score >= 85
        ? "Use best branch source as skeleton; run semantic diff against production"
        : mainSource
          ? "Compare main source semantics and apply only production-backed changes"
          : "Recover best branch source if present, otherwise reconstruct from bundle";
    rows.push({ productionModule: region.path, startLine: region.startLine, endLine: region.endLine, mainState: mainSource ? "present" : "missing", bestBranchSource, confidence, actionRequired, candidateCount: candidates.length, bestScore: best?.score ?? 0 });
    moduleCandidates.push({ productionModule: region.path, startLine: region.startLine, endLine: region.endLine, candidates: candidates.slice(0, 8) });
  }
  const branchSummary = [...uniqueTips.values()].map((item) => {
    const scores = rows.map((row) => moduleCandidates.find((candidate) => candidate.productionModule === row.productionModule)?.candidates.find((candidate) => candidate.tip === item.tip)?.score).filter((value) => typeof value === "number");
    return { refs: item.refs, tip: item.tip, candidateRegions: scores.length, meanScore: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(4)) : 0 };
  }).sort((a, b) => b.meanScore - a.meanScore || b.candidateRegions - a.candidateRegions);
  const inputHash = index.inputHash;
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, "candidate-scores.json"), `${JSON.stringify({ inputHash, generatedAt: new Date().toISOString(), branches: branchSummary, rows }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputRoot, "module-candidates.json"), `${JSON.stringify({ inputHash, generatedAt: new Date().toISOString(), modules: moduleCandidates }, null, 2)}\n`, "utf8");
  await fs.writeFile(matrixPath, matrixMarkdown(rows, branchSummary, inputHash), "utf8");
  return { rows, branchSummary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const repoRoot = process.argv[2] ?? process.cwd();
  const indexPath = process.argv[3] ?? path.resolve("recovery/bundle/module-index.json");
  const outputRoot = process.argv[4] ?? path.resolve("recovery/bundle/comparisons");
  const matrixPath = process.argv[5] ?? path.resolve("recovery/reports/RECOVERY-MATRIX.md");
  const result = await compareSourceCandidates(repoRoot, indexPath, outputRoot, matrixPath);
  console.log(JSON.stringify({ modules: result.rows.length, mainPresent: result.rows.filter((row) => row.mainState === "present").length, mainMissing: result.rows.filter((row) => row.mainState === "missing").length, branches: result.branchSummary.length, topBranch: result.branchSummary[0] ?? null }, null, 2));
}
