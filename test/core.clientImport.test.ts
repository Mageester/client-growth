import { describe, expect, it } from "vitest";

import {
  MAX_CLIENT_IMPORT_BYTES,
  MAX_CLIENT_IMPORT_ROWS,
  parseClientImport,
  validateClientImport,
} from "@/core/clientImport";
import { ClientSchema } from "@/core/schema";

describe("client import parsing", () => {
  it("parses a header, quoted CSV values, normalized domains, and semicolon offerings", () => {
    const result = parseClientImport(
      [
        "name,domain,offerings",
        '"Northwind, Heating",HTTPS://Northwind.example/services?x=1,"heat pump installation; air conditioning repair"',
        "Acme,acme.example,roofing; siding",
      ].join("\n"),
    );

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "Northwind, Heating",
        domain: "northwind.example",
        offerings: ["heat pump installation", "air conditioning repair"],
      },
      {
        line: 3,
        name: "Acme",
        domain: "acme.example",
        offerings: ["roofing", "siding"],
      },
    ]);
  });

  it("accepts data without a header and reports malformed rows", () => {
    const result = parseClientImport(
      [
        "Acme,acme.example,roofing",
        "Missing Domain,,plumbing",
        "Too Few Columns,too-few.example",
        'Unclosed,broken.example,"repair',
      ].join("\n"),
    );

    expect(result.rows).toHaveLength(3);
    expect(result.issues.map((issue) => issue.line)).toEqual([3, 4]);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "Expected name, domain and offerings columns.",
      "The CSV contains an unclosed quoted field.",
    ]);
  });

  it("bounds the import at fifty data rows", () => {
    const csv = [
      "name,domain,offerings",
      ...Array.from(
        { length: MAX_CLIENT_IMPORT_ROWS + 1 },
        (_, index) => `Client ${index},client-${index}.example,service`,
      ),
    ].join("\n");

    const result = parseClientImport(csv);

    expect(result.rows).toHaveLength(MAX_CLIENT_IMPORT_ROWS);
    expect(result.issues).toEqual([
      {
        line: MAX_CLIENT_IMPORT_ROWS + 2,
        message: `Import up to ${MAX_CLIENT_IMPORT_ROWS} clients at a time.`,
      },
    ]);
  });

  it("rejects CSV text over the byte bound before parsing rows", () => {
    const result = parseClientImport("x".repeat(MAX_CLIENT_IMPORT_BYTES + 1));

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      {
        line: 1,
        message: `Keep the CSV under ${Math.round(MAX_CLIENT_IMPORT_BYTES / 1024)} KB.`,
      },
    ]);
  });
});

describe("client import validation", () => {
  it("rejects existing tenant domains and duplicate domains in the same import", () => {
    const parsed = parseClientImport(
      [
        "name,domain,offerings",
        "Already here,https://ACME.example/,roofing",
        "First,duplicate.example,plumbing",
        "Second,https://duplicate.example/path,plumbing",
      ].join("\n"),
    );
    const existing = [
      ClientSchema.parse({
        id: "client-existing",
        name: "Acme",
        domain: "acme.example",
        offerings: [],
        notes: "",
      }),
    ];

    const result = validateClientImport(parsed.rows, existing);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { line: 2, message: 'Acme is already watching "acme.example".' },
      { line: 4, message: "This domain is repeated on row 3 of this import." },
    ]);
  });

  it("reuses client input validation for names, domains, and offering limits", () => {
    const parsed = parseClientImport(
      [
        "name,domain,offerings",
        ",valid.example,service",
        "Valid,not a domain,service",
        `Many, many.example,${Array.from({ length: 41 }, () => "service").join(";")}`,
      ].join("\n"),
    );

    const result = validateClientImport(parsed.rows, []);

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(3);
    expect(result.issues.map((issue) => issue.line)).toEqual([2, 3, 4]);
  });

  it("accepts exactly the bounded number of valid rows", () => {
    const parsed = parseClientImport(
      [
        "name,domain,offerings",
        ...Array.from(
          { length: MAX_CLIENT_IMPORT_ROWS },
          (_, index) => `Client ${index},client-${index}.example,service`,
        ),
      ].join("\n"),
    );

    expect(parsed.issues).toEqual([]);
    expect(validateClientImport(parsed.rows, [])).toEqual({ ok: true, issues: [] });
  });
});
