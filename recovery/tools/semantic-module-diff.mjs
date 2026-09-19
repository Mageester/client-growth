import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionMetadata } from "./index-bundle.mjs";

const FEATURE_KEYS = ["symbols", "imports", "routes", "environmentKeys", "sql", "stringLiterals"];

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function featureDiff(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    added: [...actualSet].filter((value) => !expectedSet.has(value)).sort(),
    removed: [...expectedSet].filter((value) => !actualSet.has(value)).sort(),
    shared: [...expectedSet].filter((value) => actualSet.has(value)).sort(),
  };
}

export function compareFeatureSets(expected, actual) {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, featureDiff(expected[key] ?? [], actual[key] ?? [])]));
}

function safeName(modulePath, startLine) {
  return `${String(startLine).padStart(7, "0")}-${modulePath.replaceAll("/", "__").replaceAll(".", "_")}`;
}

function markdownSummary(results, inputHash) {
  const lines = [
    "# Semantic module comparison",
    "",
    `- Bundle input SHA-256: \`${inputHash}\``,
    `- Regions compared: ${results.length}`,
    `- Regions with a GitHub source candidate: ${results.filter((result) => result.sourceStatus === "candidate").length}`,
    `- Regions without a GitHub source candidate: ${results.filter((result) => result.sourceStatus === "missing").length}`,
    "",
    "| Module | Bundle lines | Source status | Source candidate | Added features | Removed features |",
    "| --- | ---: | --- | --- | ---: | ---: |",
  ];
  for (const result of results) {
    const added = FEATURE_KEYS.reduce((sum, key) => sum + result.featureDiff[key].added.length, 0);
    const removed = FEATURE_KEYS.reduce((sum, key) => sum + result.featureDiff[key].removed.length, 0);
    lines.push(`| \`${result.path}\` | ${result.startLine}-${result.endLine} | ${result.sourceStatus} | ${result.sourceRef ?? "none"} | ${added} | ${removed} |`);
  }
  return `${lines.join("\n")}\n`;
}

export async function compareModules({ repoRoot, bundlePath, indexPath, candidatesPath, outputRoot }) {
  const [source, index, candidateIndex] = await Promise.all([
    fs.readFile(bundlePath, "utf8"),
    fs.readFile(indexPath, "utf8").then(JSON.parse),
    fs.readFile(candidatesPath, "utf8").then(JSON.parse),
  ]);
  const lines = source.split("\n");
  const regionsRoot = path.join(outputRoot, "regions");
  await fs.mkdir(regionsRoot, { recursive: true });
  const sourceCache = new Map();
  const results = [];
  for (const region of index.regions.filter((entry) => entry.projectOwned)) {
    const regionText = lines.slice(region.startLine - 1, region.endLine).join("\n");
    const candidateEntry = candidateIndex.modules.find((entry) => entry.productionModule === region.path && entry.startLine === region.startLine);
    const best = candidateEntry?.candidates?.[0] ?? null;
    let sourceText = null;
    let sourceRef = null;
    if (best) {
      sourceRef = `${best.refs[0]}:${best.path}@${best.tip.slice(0, 12)}`;
      const cacheKey = `${best.refs[0]}:${best.path}`;
      if (!sourceCache.has(cacheKey)) {
        try { sourceCache.set(cacheKey, git(repoRoot, ["show", `${best.refs[0]}:${best.path}`])); }
        catch { sourceCache.set(cacheKey, null); }
      }
      sourceText = sourceCache.get(cacheKey);
    }
    const sourceFeatures = sourceText === null ? null : regionMetadata(sourceText);
    const bundleFeatures = Object.fromEntries(FEATURE_KEYS.map((key) => [key, region[key] ?? []]));
    const evidenceFile = path.join(regionsRoot, `${safeName(region.path, region.startLine)}.js`);
    await fs.writeFile(evidenceFile, regionText, "utf8");
    results.push({
      path: region.path,
      startLine: region.startLine,
      endLine: region.endLine,
      emittedRegionSha256: crypto.createHash("sha256").update(regionText).digest("hex"),
      emittedRegionEvidence: path.relative(outputRoot, evidenceFile),
      sourceStatus: sourceText === null ? "missing" : "candidate",
      sourceRef,
      sourceSha256: sourceText === null ? null : crypto.createHash("sha256").update(sourceText).digest("hex"),
      featureDiff: compareFeatureSets(bundleFeatures, sourceFeatures ?? Object.fromEntries(FEATURE_KEYS.map((key) => [key, []]))),
    });
  }
  const inputHash = index.inputHash;
  await fs.writeFile(path.join(outputRoot, "semantic-diffs.json"), `${JSON.stringify({ inputHash, generatedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputRoot, "semantic-diff.md"), markdownSummary(results, inputHash), "utf8");
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const repoRoot = process.argv[2] ?? process.cwd();
  const bundlePath = process.argv[3] ?? path.resolve("recovery/evidence/known/extracted/app.js");
  const indexPath = process.argv[4] ?? path.resolve("recovery/bundle/module-index.json");
  const candidatesPath = process.argv[5] ?? path.resolve("recovery/bundle/comparisons/module-candidates.json");
  const outputRoot = process.argv[6] ?? path.resolve("recovery/bundle/comparisons");
  const results = await compareModules({ repoRoot, bundlePath, indexPath, candidatesPath, outputRoot });
  console.log(JSON.stringify({ regions: results.length, candidates: results.filter((result) => result.sourceStatus === "candidate").length, missing: results.filter((result) => result.sourceStatus === "missing").length }, null, 2));
}
