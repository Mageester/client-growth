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
      // Says how many columns it actually found, so the fix is obvious.
      "Expected 3 columns (name, domain, offerings); found 2.",
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

/**
 * An agency's client list lives in a spreadsheet, and copying rows out of one
 * produces TAB separated text. Rejecting that meant the most likely route into
 * a bulk importer failed on every row with "Expected name, domain and
 * offerings columns" and no indication why.
 */
describe("pasting straight out of a spreadsheet", () => {
  const TAB = "\t";

  it("accepts tab separated rows", () => {
    const pasted = [
      ["name", "domain", "offerings"].join(TAB),
      ["Atlas Plumbing", "atlasplumbing.ca", "Drain cleaning;Leak detection"].join(TAB),
      ["Cambridge Heating", "cambridgeheating.ca", "Furnace repair;Duct cleaning"].join(TAB),
    ].join("\n");

    const result = parseClientImport(pasted);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.name).toBe("Atlas Plumbing");
    expect(result.rows[0]?.domain).toBe("atlasplumbing.ca");
    expect(result.rows[0]?.offerings).toEqual(["Drain cleaning", "Leak detection"]);
  });

  it("still reads a comma separated paste, including a quoted comma", () => {
    // Commas win any tie: a CSV whose field contains a tab is still a CSV.
    const result = parseClientImport(
      'name,domain,offerings\n"Smith, Jones & Co",smithjones.example,Roofing;Guttering\n',
    );

    expect(result.issues).toEqual([]);
    expect(result.rows[0]?.name).toBe("Smith, Jones & Co");
    expect(result.rows[0]?.offerings).toEqual(["Roofing", "Guttering"]);
  });

  it("says what is wrong when a row has only one column", () => {
    const result = parseClientImport("name;domain;offerings\nAtlas Plumbing only\n");

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.message).toMatch(/commas or tabs/i);
  });
});
