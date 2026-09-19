import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enumerateLiveAssets, extractReferences, isAcceptedStaticUrl } from "./enumerate-live-assets.mjs";

test("accepts same-origin static references and rejects external or dynamic URLs", () => {
  const html = `
    <script src="/build/client.js"></script>
    <link rel="stylesheet" href="/build/app.css">
    <link rel="preload" href="https://cdn.example.invalid/font.woff2">
    <a href="/login">login</a>
  `;
  const references = extractReferences(html, "https://orbit.getaxiom.ca/");
  assert.deepEqual(references, [
    "https://orbit.getaxiom.ca/build/client.js",
    "https://orbit.getaxiom.ca/build/app.css",
  ]);
  assert.equal(isAcceptedStaticUrl(new URL("https://orbit.getaxiom.ca/app.js.map")), true);
  assert.equal(isAcceptedStaticUrl(new URL("https://cdn.example.invalid/app.js")), false);
  assert.equal(isAcceptedStaticUrl(new URL("https://orbit.getaxiom.ca/cdn-cgi/challenge-platform/main.js")), false);
});

test("enumerates same-origin static references from the homepage", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<script src="/assets/app.js"></script>');
      return;
    }
    if (request.url === "/assets/app.js") {
      response.setHeader("content-type", "application/javascript");
      response.end("console.log('asset')");
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "orbit-assets-"));
  try {
    const manifest = await enumerateLiveAssets(baseUrl, outputRoot);
    assert.equal(manifest.records.some((record) => record.requestedUrl.endsWith("/assets/app.js") && record.status === 200), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(outputRoot, { recursive: true, force: true });
  }
});
