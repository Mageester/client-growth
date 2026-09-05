/**
 * Dev-only static server for the design harness output. Local review tool;
 * never imported by the Worker.
 *
 *   node scripts/harness-server.mjs [dir] [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.argv[2] ?? ".design-harness";
const port = Number(process.argv[3] ?? 4321);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const candidates = [join(root, normalize(rel)), join("public", normalize(rel))];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
      return;
    } catch {
      // try the next root
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}).listen(port, () => console.log(`harness on http://localhost:${port}`));
