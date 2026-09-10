import { useEffect, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import {
  MAX_CLIENT_IMPORT_BYTES,
  MAX_CLIENT_IMPORT_ROWS,
  parseClientImport,
  validateClientImport,
  type ClientImportIssue,
  type ClientImportRow,
} from "@/core/clientImport";
import { ClientSchema } from "@/core/schema";
import { ClientImportConflictError, insertClientsAtomically } from "@/db/clientImport";
import * as repo from "@/db/repositories";
import { requireTenant } from "../lib/session.server";
import { Icon } from "../components/ui";
import type { Route } from "./+types/clients.import";

export function meta() {
  return [{ title: "Import clients · Axiom Orbit" }];
}

/**
 * The form body includes URL encoding around the CSV. Keep a separate bound
 * for that envelope, and enforce it while reading the stream so a missing or
 * inaccurate Content-Length cannot make formData() buffer an unbounded body.
 */
export const MAX_CLIENT_IMPORT_REQUEST_BYTES = MAX_CLIENT_IMPORT_BYTES * 2;

type ImportInputError = {
  ok: false;
  stage: "input";
  error: string;
};

function importInputError(message: string): ImportInputError {
  return { ok: false, stage: "input", error: message };
}

function importRequestSizeError(): ImportInputError {
  return importInputError(
    `Keep the CSV request under ${Math.round(MAX_CLIENT_IMPORT_REQUEST_BYTES / 1024)} KB.`,
  );
}

/** Read and rebuild the URL encoded form only after enforcing the byte bound. */
async function boundedFormRequest(request: Request): Promise<Request | ImportInputError> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CLIENT_IMPORT_REQUEST_BYTES) {
    return importRequestSizeError();
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType && mediaType !== "application/x-www-form-urlencoded") {
    return importInputError("Submit the import using the CSV form.");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_CLIENT_IMPORT_REQUEST_BYTES) {
          await reader.cancel().catch(() => undefined);
          return importRequestSizeError();
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  // The original value may describe an untrusted or compressed stream. The
  // rebuilt request contains exactly the bytes we measured.
  headers.delete("content-length");
  headers.delete("transfer-encoding");

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = body;
  return new Request(request.url, init);
}

function clientIdBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "unnamed"
  );
}

function nextClientId(name: string, taken: Set<string>): string {
  let id = "";
  do {
    const suffix =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    id = `client-${clientIdBase(name)}-${suffix}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

function previewResult(
  raw: string,
  rows: ClientImportRow[],
  issues: ClientImportIssue[],
) {
  return {
    ok: issues.length === 0,
    stage: "preview" as const,
    raw,
    rows,
    issues,
  };
}

async function checkImport(t: Awaited<ReturnType<typeof requireTenant>>, raw: string) {
  const parsed = parseClientImport(raw);
  const existing = await repo.listClients(t.scope);
  const validation = validateClientImport(parsed.rows, existing);
  return {
    existing,
    rows: parsed.rows,
    issues: [...parsed.issues, ...validation.issues].sort(
      (left, right) => left.line - right.line,
    ),
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return { existingCount: (await repo.listClients(t.scope)).length };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const bounded = await boundedFormRequest(request);
  if (!(bounded instanceof Request)) return bounded;

  let form: FormData;
  try {
    form = await bounded.formData();
  } catch {
    return importInputError("Submit the import using the CSV form.");
  }
  const intent = String(form.get("intent") ?? "");
  if (intent !== "preview" && intent !== "confirm") {
    throw new Response("Unknown import action", { status: 400 });
  }

  const raw = String(form.get("csv") ?? "");
  if (new TextEncoder().encode(raw).byteLength > MAX_CLIENT_IMPORT_BYTES) {
    return importInputError(`Keep the CSV under ${Math.round(MAX_CLIENT_IMPORT_BYTES / 1024)} KB.`);
  }
  const checked = await checkImport(t, raw);
  if (intent === "preview" || checked.issues.length > 0) {
    return previewResult(raw, checked.rows, checked.issues);
  }

  // IDs are generated only after the second validation pass. The set also
  // protects against an accidental overwrite if a generated ID already exists.
  const takenIds = new Set(checked.existing.map((client) => client.id));
  const clients = checked.rows.map((row) =>
    ClientSchema.parse({
      id: nextClientId(row.name, takenIds),
      name: row.name,
      domain: row.domain,
      offerings: row.offerings,
      notes: "",
    }),
  );
  try {
    await insertClientsAtomically(t.scope, clients);
  } catch (error) {
    if (error instanceof ClientImportConflictError) {
      const current = await checkImport(t, raw);
      return previewResult(raw, current.rows, [
        ...current.issues,
        { line: 1, message: error.message },
      ]);
    }
    throw error;
  }

  return {
    ok: true as const,
    stage: "complete" as const,
    imported: checked.rows.length,
    clients: clients.map((client) => ({ id: client.id, name: client.name })),
  };
}

type PreviewData = {
  stage: "preview";
  ok: boolean;
  raw: string;
  rows: ClientImportRow[];
  issues: ClientImportIssue[];
};

export default function ClientsImport({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState("");
  const preview = actionData?.stage === "preview" ? (actionData as PreviewData) : null;
  const previewIsCurrent = preview !== null && preview.raw === csv;

  useEffect(() => {
    if (actionData?.stage === "preview") setCsv(actionData.raw);
    if (actionData?.stage === "complete") setCsv("");
  }, [actionData]);

  return (
    <div className="directory-page clients-import">
      <div className="pagehead">
        <div className="pagehead-copy">
          <Link className="link" to="/clients">
            <Icon name="arrow-left" size={14} /> Back to clients
          </Link>
          <span className="eyebrow" style={{ marginTop: "1rem" }}>
            Portfolio
          </span>
          <h1 className="title-page">Import clients</h1>
          <p className="lede">
            Paste a CSV with <b>name</b>, <b>domain</b>, and <b>offerings</b>. Separate offerings
            with semicolons. We preview every row and check domains again when you confirm.
          </p>
        </div>
        <div className="pagehead-actions">
          <Link className="btn btn-ghost" to="/clients">
            Cancel
          </Link>
        </div>
      </div>

      {actionData?.stage === "complete" && (
        <div className="notice ok import-complete" role="status">
          <Icon name="check" size={15} />
          <div>
            Imported {actionData.imported} {actionData.imported === 1 ? "client" : "clients"}.
            Nothing was crawled or analyzed.
            <div className="form-actions">
              {actionData.clients.length === 1 && (
                <Link className="btn btn-sm btn-primary" to={`/clients/${actionData.clients[0]!.id}`}>
                  Open {actionData.clients[0]!.name}
                </Link>
              )}
              <Link className="btn btn-sm" to="/clients">
                View imported clients
              </Link>
            </div>
            <p className="field-hint">Choose a client, review its context, then run its first analysis.</p>
          </div>
        </div>
      )}
      {actionData?.stage === "input" && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Add your client list</h2>
            <p>
              {loaderData.existingCount} {loaderData.existingCount === 1 ? "client is" : "clients are"}{" "}
              already in this workspace. Existing domains are never overwritten.
            </p>
          </div>
          <span className="pill quiet">Up to {MAX_CLIENT_IMPORT_ROWS}</span>
        </div>

        {actionData && actionData.stage === "preview" && actionData.issues.length > 0 && (
          <div className="notice err" role="alert">
            <Icon name="alert" size={15} />
            <div>
              <b>Fix these rows before importing.</b>
              <ul>
                {actionData.issues.map((issue) => (
                  <li key={`${issue.line}-${issue.message}`}>
                    Row {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="preview" />
          <div className="field client-import-file">
            <label htmlFor="client-import-file">Choose a CSV file</label>
            <input
              id="client-import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                if (file.size > MAX_CLIENT_IMPORT_BYTES) {
                  setFileError(`Keep the CSV under ${Math.round(MAX_CLIENT_IMPORT_BYTES / 1024)} KB.`);
                  return;
                }
                setFileError("");
                setCsv(await file.text());
              }}
              aria-describedby="client-import-file-help"
            />
            <div id="client-import-file-help" className="field-hint">
              The file is read in this browser and placed in the review box below. Nothing is
              imported until you preview and confirm it.
            </div>
            {fileError && <div className="notice err" role="alert">{fileError}</div>}
            <a
              className="link"
              download="axiom-orbit-client-import-template.csv"
              href="data:text/csv;charset=utf-8,name%2Cdomain%2Cofferings%0ANorthwind%20Heating%2Cnorthwind.example%2C%22heat%20pumps%3B%20duct%20cleaning%22"
            >
              Download example CSV
            </a>
          </div>
          <div className="import-divider" aria-hidden="true"><span>or paste</span></div>
          <div className="field">
            <label htmlFor="client-import-csv">CSV rows</label>
            <textarea
              id="client-import-csv"
              name="csv"
              rows={12}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={
                "name,domain,offerings\nNorthwind Heating,northwind.example,heat pump installation; duct cleaning\nAcme Roofing,acme.example,roofing; siding"
              }
              spellCheck={false}
            />
            <div className="field-hint">
              Include a header row or leave it out. One row per client; commas inside a name or
              domain need CSV quotes. Empty offerings are allowed and can be filled in later.
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || csv.trim() === ""}>
              <Icon name="document" size={14} />
              {busy ? "Checking…" : "Preview import"}
            </button>
            <Link className="btn btn-ghost" to="/clients">
              Cancel
            </Link>
          </div>
        </Form>
      </section>

      {preview && (
        <section className="section" aria-live="polite">
          <div className="section-head">
            <div>
              <h2 className="title-section">Preview</h2>
              <p>
                {preview.rows.length} {preview.rows.length === 1 ? "client" : "clients"} parsed.
                Review the exact records that will be created.
              </p>
            </div>
            {preview.issues.length === 0 && <span className="pill pos">Ready to import</span>}
          </div>

          {preview.rows.length > 0 && (
            <ul className="records" aria-label="Client import preview">
              {preview.rows.map((row) => (
                <li key={row.line}>
                  <div className="record import-record">
                    <span className="record-main">
                      <span className="record-name">{row.name || "Unnamed client"}</span>
                      <span className="record-meta">
                        <span className="mono">Row {row.line}</span>
                        <span className="dot-sep">·</span>
                        <span>{row.domain || "No valid domain"}</span>
                      </span>
                      <span className="offer-line">
                        {row.offerings.length > 0 ? row.offerings.join(" · ") : "No offerings listed"}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {preview.issues.length === 0 && preview.rows.length > 0 && previewIsCurrent && (
            <Form method="post">
              <input type="hidden" name="intent" value="confirm" />
              <input type="hidden" name="csv" value={preview.raw} />
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Icon name="users" size={14} />
                  {busy
                    ? "Importing…"
                    : `Confirm and import ${preview.rows.length} ${preview.rows.length === 1 ? "client" : "clients"}`}
                </button>
                <span className="field-hint">This creates new client profiles only. No crawl or analysis starts.</span>
              </div>
            </Form>
          )}
          {preview.issues.length === 0 && !previewIsCurrent && (
            <div className="notice" role="status">
              <Icon name="alert" size={15} />
              <span>The CSV changed after this preview. Preview it again before confirming.</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
