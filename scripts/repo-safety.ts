import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RepoFile {
  path: string;
  content: string;
}

export interface SecretFinding {
  path: string;
  line: number;
  rule: string;
}

const SECRET_PATTERNS = [
  { rule: "Resend API credential", expression: /\bre_[A-Za-z0-9_-]{20,}\b/g },
  { rule: "API credential", expression: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g },
  { rule: "private key marker", expression: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/g },
] as const;

/** Exact fake values used by the repository's existing test fixtures. */
const ALLOWED_FIXTURE_LITERALS = [
  "sk-test",
  "test-resend-key",
  "re_test_fixture_12345678901234567890",
] as const;

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isExamplePath(path: string): boolean {
  const file = basename(normalizePath(path));
  return /\.example(?:\.[^/]*)?$/i.test(file);
}

function isSensitiveFile(path: string): boolean {
  const file = basename(normalizePath(path));
  if (isExamplePath(path)) return false;
  return (
    /^\.env(?:\..*)?$/i.test(file) ||
    /^\.dev\.vars(?:\..*)?$/i.test(file) ||
    /^\.(?:credentials?|secrets?)(?:\.[^/]*)?$/i.test(file) ||
    /^(?:credentials?|secrets?|service-account(?:[-_].*)?|id_(?:rsa|dsa|ecdsa|ed25519))(?:\.[^/]*)?$/i.test(
      file,
    ) ||
    /\.(?:pem|p12|pfx|key)$/i.test(file)
  );
}

export function findSensitivePaths(paths: readonly string[]): string[] {
  return paths.map(normalizePath).filter(isSensitiveFile);
}

function removeAllowedFixtureLiterals(content: string): string {
  return ALLOWED_FIXTURE_LITERALS.reduce(
    (scrubbed, literal) => scrubbed.split(literal).join(" ".repeat(literal.length)),
    content,
  );
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function isBinary(content: string): boolean {
  return content.includes("\u0000");
}

export function findSecretFindings(files: readonly RepoFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (isBinary(file.content)) continue;
    const scrubbed = removeAllowedFixtureLiterals(file.content);
    for (const pattern of SECRET_PATTERNS) {
      pattern.expression.lastIndex = 0;
      for (const match of scrubbed.matchAll(pattern.expression)) {
        if (match.index === undefined) continue;
        const finding = {
          path: normalizePath(file.path),
          line: lineNumberAt(scrubbed, match.index),
          rule: pattern.rule,
        } satisfies SecretFinding;
        const key = `${finding.path}:${finding.line}:${finding.rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(finding);
      }
    }
  }

  return findings;
}

export function validateRepositoryFiles(files: readonly RepoFile[]): string[] {
  const filenameErrors = findSensitivePaths(files.map((file) => file.path)).map(
    (path) => `forbidden sensitive file: ${path}`,
  );
  const contentErrors = findSecretFindings(files).map(
    (finding) => `possible ${finding.rule} in ${finding.path}:${finding.line}`,
  );
  return [...filenameErrors, ...contentErrors];
}

function trackedPaths(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

function diffCheckFailed(cached: boolean): boolean {
  const args = ["diff", "--check"];
  if (cached) args.push("--cached");
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  return result.error !== undefined || result.status !== 0;
}

function main(): void {
  try {
    const files = trackedPaths().map((path) => ({
      path,
      content: readFileSync(path, "utf8"),
    }));
    const errors = validateRepositoryFiles(files);
    if (diffCheckFailed(false)) errors.push("git diff --check failed for the working tree");
    if (diffCheckFailed(true)) errors.push("git diff --check failed for the index");

    if (errors.length > 0) {
      console.error("Repository safety check failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Repository safety check passed: scanned ${files.length} tracked files.`);
  } catch (error) {
    console.error(
      `Repository safety check could not complete: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
