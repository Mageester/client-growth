import type { Client } from "@/core/schema";

const MAX_NAME_LENGTH = 120;
const MAX_OFFERINGS = 40;
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Keep the import boundary aligned with the client form's hostname normalizer. */
function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const withoutCredentials = withoutScheme.replace(/^[^@/]*@/, "");
  const host = withoutCredentials.split(/[\/?#]/, 1)[0] ?? "";
  return host.replace(/\.+$/, "");
}

/** The import is intentionally small enough to preview in one screen. */
export const MAX_CLIENT_IMPORT_ROWS = 50;
/** Bound the text that reaches the CSV parser and the preview form. */
export const MAX_CLIENT_IMPORT_BYTES = 256 * 1024;

export interface ClientImportRow {
  /** One based physical CSV line, including a header when present. */
  line: number;
  name: string;
  domain: string;
  offerings: string[];
}

export interface ClientImportIssue {
  line: number;
  message: string;
}

export interface ClientImportParseResult {
  rows: ClientImportRow[];
  issues: ClientImportIssue[];
}

export interface ClientImportValidationResult {
  ok: boolean;
  issues: ClientImportIssue[];
}

interface CsvRecord {
  line: number;
  cells: string[];
}

function pushRecord(records: CsvRecord[], line: number, cells: string[]): void {
  // A blank line is formatting, not an invalid client. Keeping it out of the
  // row count lets a pasted export contain a trailing newline safely.
  if (cells.every((cell) => cell.trim() === "")) return;
  records.push({ line, cells });
}

/**
 * Which character separates the columns of this paste.
 *
 * An agency's client list lives in a spreadsheet, and copying rows out of one
 * yields TAB separated text, not commas — so the most likely way anyone
 * arrives at this box produced nine rows of "Expected name, domain and
 * offerings columns" and no clue why. Sniffing the delimiter costs nothing and
 * removes the single most likely first-run failure.
 *
 * Commas win any tie: a comma-separated row whose fields happen to contain a
 * tab is still a CSV, and quoted fields are only meaningful for the comma form.
 */
function detectDelimiter(input: string): "," | "\t" {
  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (line.includes(",")) return ",";
    if (line.includes("\t")) return "\t";
  }
  return ",";
}

/** Parse delimited records while preserving quoted separators and newlines. */
function parseCsvRecords(input: string): { records: CsvRecord[]; issues: ClientImportIssue[] } {
  const delimiter = detectDelimiter(input);
  const records: CsvRecord[] = [];
  const issues: ClientImportIssue[] = [];
  const cells: string[] = [];
  let value = "";
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;

  const finishCell = (): void => {
    cells.push(value);
    value = "";
  };
  const finishRecord = (): void => {
    finishCell();
    pushRecord(records, recordLine, cells.splice(0));
    recordLine = line + 1;
  };

  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r" || character === "\n") {
        value += "\n";
        if (character === "\r" && input[index + 1] === "\n") index++;
        line++;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.trim() === "") {
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      finishCell();
      continue;
    }
    if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && input[index + 1] === "\n") index++;
      line++;
      continue;
    }
    value += character;
  }

  if (inQuotes) {
    issues.push({ line: recordLine, message: "The CSV contains an unclosed quoted field." });
  }

  // A final newline already committed the final record. Otherwise commit the
  // last line, including a single value with no trailing comma.
  if (value !== "" || cells.length > 0) finishRecord();
  return { records, issues };
}

function isHeader(record: CsvRecord): boolean {
  const cells = record.cells.map((cell) => cell.trim().toLowerCase().replace(/^\uFEFF/, ""));
  return cells.length === 3 && cells[0] === "name" && cells[1] === "domain" && cells[2] === "offerings";
}

function parseOfferings(value: string): string[] {
  return value
    .split(";")
    .map((offering) => offering.trim())
    .filter(Boolean);
}

function validateRow(row: ClientImportRow): string | null {
  if (!row.name) return "Give this client a name.";
  if (row.name.length > MAX_NAME_LENGTH) {
    return `Client names are limited to ${MAX_NAME_LENGTH} characters.`;
  }
  if (!row.domain) return "Enter the client's website.";
  if (row.domain.length > 253) return "That website address is too long to be a real domain.";
  if (!HOSTNAME.test(row.domain)) {
    return `\"${row.domain}\" does not look like a website address. Try something like example.com.`;
  }
  if (row.offerings.length > MAX_OFFERINGS) {
    return `List up to ${MAX_OFFERINGS} offerings. Group the rest — the analysis works best on the main service lines.`;
  }
  if (row.offerings.some((line) => line.length > MAX_NAME_LENGTH)) {
    return "Keep each offering short — a service name, not a sentence.";
  }
  return null;
}

/** Parse a CSV export into normalized, previewable rows without writing data. */
export function parseClientImport(input: string): ClientImportParseResult {
  if (new TextEncoder().encode(input).byteLength > MAX_CLIENT_IMPORT_BYTES) {
    return {
      rows: [],
      issues: [
        {
          line: 1,
          message: `Keep the CSV under ${Math.round(MAX_CLIENT_IMPORT_BYTES / 1024)} KB.`,
        },
      ],
    };
  }
  const parsed = parseCsvRecords(input);
  const issues = [...parsed.issues];
  const first = parsed.records[0];
  const data = first && isHeader(first) ? parsed.records.slice(1) : parsed.records;
  const bounded = data.slice(0, MAX_CLIENT_IMPORT_ROWS);

  if (data.length > MAX_CLIENT_IMPORT_ROWS) {
    issues.push({
      line: data[MAX_CLIENT_IMPORT_ROWS]?.line ?? MAX_CLIENT_IMPORT_ROWS + 1,
      message: `Import up to ${MAX_CLIENT_IMPORT_ROWS} clients at a time.`,
    });
  }
  if (data.length === 0 && parsed.issues.length === 0) {
    issues.push({ line: first?.line ?? 1, message: "Add at least one client row." });
  }

  const rows: ClientImportRow[] = [];
  for (const record of bounded) {
    if (record.cells.length !== 3) {
      issues.push({
        line: record.line,
        message:
          record.cells.length === 1
            ? "This row has one column. Separate name, domain and offerings with commas or tabs."
            : `Expected 3 columns (name, domain, offerings); found ${record.cells.length}.`,
      });
      continue;
    }
    const [rawName, rawDomain, rawOfferings] = record.cells;
    rows.push({
      line: record.line,
      name: (rawName ?? "").trim(),
      domain: normalizeDomain(rawDomain ?? ""),
      offerings: parseOfferings(rawOfferings ?? ""),
    });
  }

  issues.sort((left, right) => left.line - right.line);
  return { rows, issues };
}

/**
 * Validate parsed rows against the same client form contract and current
 * tenant clients. This is called both at preview and immediately before the
 * confirmed writes, because another tab may have added a domain in between.
 */
export function validateClientImport(
  rows: readonly ClientImportRow[],
  existing: readonly Pick<Client, "name" | "domain">[],
): ClientImportValidationResult {
  const issues: ClientImportIssue[] = [];
  const existingByDomain = new Map<string, Pick<Client, "name" | "domain">>();
  for (const client of existing) {
    const domain = normalizeDomain(client.domain);
    if (domain) existingByDomain.set(domain, client);
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    const problem = validateRow(row);
    if (problem) {
      issues.push({ line: row.line, message: problem });
      continue;
    }

    const domain = normalizeDomain(row.domain);
    const existingClient = existingByDomain.get(domain);
    if (existingClient) {
      issues.push({
        line: row.line,
        message: `${existingClient.name} is already watching "${domain}".`,
      });
      continue;
    }

    const previousLine = seen.get(domain);
    if (previousLine !== undefined) {
      issues.push({
        line: row.line,
        message: `This domain is repeated on row ${previousLine} of this import.`,
      });
      continue;
    }
    seen.set(domain, row.line);
  }

  return { ok: issues.length === 0, issues };
}

/** Shared limit for UI copy and tests; importing cannot bypass the normal name cap. */
export const CLIENT_IMPORT_NAME_LIMIT = MAX_NAME_LENGTH;
