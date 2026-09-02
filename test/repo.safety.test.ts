import { describe, expect, it } from "vitest";

import {
  findSecretFindings,
  findSensitivePaths,
  validateRepositoryFiles,
  type RepoFile,
} from "../scripts/repo-safety";

describe("repository safety scanner", () => {
  it("flags committed environment, credential, and private-key filenames but allows examples", () => {
    expect(
      findSensitivePaths([
        ".env",
        ".env.production",
        ".dev.vars",
        "config/credentials.json",
        ".secrets",
        "config/.credentials",
        "keys/server.pem",
        "id_rsa",
        ".env.example",
        ".dev.vars.example",
        "docs/secrets.example.json",
      ]),
    ).toEqual([
      ".env",
      ".env.production",
      ".dev.vars",
      "config/credentials.json",
      ".secrets",
      "config/.credentials",
      "keys/server.pem",
      "id_rsa",
    ]);
  });

  it("detects high-confidence credentials and private-key markers without exposing values", () => {
    const resendCredential = ["re_", "123456789012345678901234"].join("");
    const apiCredential = ["sk-", "123456789012345678901234"].join("");
    const privateKeyBegin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const privateKeyEnd = ["-----END", "PRIVATE KEY-----"].join(" ");
    const files: RepoFile[] = [
      {
        path: "src/config.ts",
        content: `export const resend = "${resendCredential}";\n`,
      },
      {
        path: "src/provider.ts",
        content: `export const deepseek = "${apiCredential}";\n`,
      },
      {
        path: "docs/notes.txt",
        content: `${privateKeyBegin}\nredacted\n${privateKeyEnd}\n`,
      },
      {
        path: "test/fixtures/fake-credentials.ts",
        content:
          'const resend = "re_test_fixture_12345678901234567890";\nconst key = "sk-test";\nconst reset = "test-resend-key";\n',
      },
    ];

    expect(findSecretFindings(files)).toEqual([
      { path: "src/config.ts", line: 1, rule: "Resend API credential" },
      { path: "src/provider.ts", line: 1, rule: "API credential" },
      { path: "docs/notes.txt", line: 1, rule: "private key marker" },
    ]);

    const errors = validateRepositoryFiles(files);
    expect(errors).toEqual([
      "possible Resend API credential in src/config.ts:1",
      "possible API credential in src/provider.ts:1",
      "possible private key marker in docs/notes.txt:1",
    ]);
    expect(errors.join(" ")).not.toContain("123456789012345678901234");
  });
});
