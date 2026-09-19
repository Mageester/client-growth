import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATIC_EXTENSIONS = new Set([
  ".css", ".ico", ".js", ".json", ".jpg", ".jpeg", ".map", ".png", ".svg",
  ".webp", ".woff", ".woff2",
]);

export function isAcceptedStaticUrl(url, origin = "https://orbit.getaxiom.ca") {
  if (url.origin !== origin) return false;
  if (url.pathname === "/cdn-cgi" || url.pathname.startsWith("/cdn-cgi/")) return false;
  const extension = path.posix.extname(url.pathname).toLowerCase();
  return STATIC_EXTENSIONS.has(extension);
}

export function extractReferences(html, baseUrl) {
  const base = new URL(baseUrl);
  const references = [];
  const attributePattern = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(attributePattern)) {
    try {
      const url = new URL(match[2], base);
      if (isAcceptedStaticUrl(url, base.origin)) references.push(url.href);
    } catch {
      // Ignore malformed or non-URL attributes; they are not evidence assets.
    }
  }
  return [...new Set(references)];
}

function extractSourceMapReferences(text, baseUrl) {
  const base = new URL(baseUrl);
  const references = [];
  const pattern = /(?:\/\/|\/\*#)\s*#?\s*sourceMappingURL\s*=\s*([^\s*]+?)(?:\*\/)?$/gim;
  for (const match of text.matchAll(pattern)) {
    try {
      const url = new URL(match[1].trim(), base);
      if (isAcceptedStaticUrl(url, base.origin) && url.pathname.toLowerCase().endsWith(".map")) {
        references.push(url.href);
      }
    } catch {
      // Ignore malformed source-map references.
    }
  }
  return [...new Set(references)];
}

function localPathForUrl(url, root) {
  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const parts = relative.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Unsafe asset path: ${url.pathname}`);
  }
  const destination = path.resolve(root, ...parts);
  const resolvedRoot = path.resolve(root);
  if (destination !== resolvedRoot && !destination.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Asset path escapes output root: ${url.pathname}`);
  }
  return destination;
}

async function sha256(bytes) {
  const hash = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(bytes).digest("hex"));
  return hash;
}

async function fetchPublic(url) {
  const response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes,
  };
}

async function writeIfNew(destination, bytes) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await fs.readFile(destination);
    if (!existing.equals(bytes)) throw new Error(`Refusing to overwrite hash-mismatched evidence: ${destination}`);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.writeFile(destination, bytes);
    return true;
  }
}

async function extractMapSources(mapRecord, mapsRoot) {
  let parsed;
  try {
    parsed = JSON.parse(mapRecord.bytes.toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.sourcesContent)) return [];
  const sourceRoot = path.join(mapsRoot, "sources-content");
  const extracted = [];
  for (let index = 0; index < parsed.sourcesContent.length; index += 1) {
    const content = parsed.sourcesContent[index];
    if (typeof content !== "string") continue;
    const sourceName = String(parsed.sources?.[index] ?? `source-${index}.txt`)
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[^A-Za-z0-9._-]/g, "_") || `source-${index}.txt`;
    const destination = path.join(sourceRoot, `${String(index).padStart(4, "0")}-${sourceName}`);
    await writeIfNew(destination, Buffer.from(content, "utf8"));
    extracted.push({ index, source: parsed.sources?.[index] ?? null, destination: path.relative(mapsRoot, destination) });
  }
  return extracted;
}

export async function enumerateLiveAssets(baseUrl, outputRoot) {
  const base = new URL(baseUrl);
  const assetsRoot = path.join(outputRoot, "assets");
  const mapsRoot = path.join(outputRoot, "maps");
  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.mkdir(mapsRoot, { recursive: true });

  const queue = [base.href];
  const queued = new Set(queue);
  const records = [];
  const extractedSources = [];
  while (queue.length > 0) {
    const requestedUrl = queue.shift();
    const url = new URL(requestedUrl);
    const destinationRoot = url.pathname.toLowerCase().endsWith(".map") ? mapsRoot : assetsRoot;
    let result;
    try {
      result = await fetchPublic(requestedUrl);
    } catch (error) {
      records.push({ requestedUrl, status: null, error: String(error), bytes: 0 });
      continue;
    }
    const record = {
      requestedUrl,
      finalUrl: result.finalUrl,
      status: result.status,
      contentType: result.contentType,
      bytes: result.bytes.length,
      sha256: await sha256(result.bytes),
      saved: false,
      sourceMapReferences: [],
    };
    if (result.status >= 200 && result.status < 300 && new URL(result.finalUrl).origin === base.origin) {
      const destination = localPathForUrl(new URL(result.finalUrl), destinationRoot);
      record.localPath = path.relative(outputRoot, destination);
      record.saved = await writeIfNew(destination, result.bytes);
      const text = result.bytes.toString("utf8");
      const htmlReferences = result.contentType.includes("text/html")
        ? extractReferences(text, result.finalUrl)
        : [];
      for (const reference of htmlReferences) {
        if (!queued.has(reference)) {
          queued.add(reference);
          queue.push(reference);
        }
      }
      const references = extractSourceMapReferences(text, result.finalUrl);
      record.sourceMapReferences = references;
      for (const reference of references) {
        if (!queued.has(reference)) {
          queued.add(reference);
          queue.push(reference);
        }
      }
      if (destinationRoot === mapsRoot) {
        const sources = await extractMapSources({ bytes: result.bytes }, mapsRoot);
        extractedSources.push(...sources.map((source) => ({ ...source, map: record.localPath })));
      }
    }
    records.push(record);
  }

  const manifest = {
    baseUrl: base.href,
    origin: base.origin,
    fetchedAt: new Date().toISOString(),
    records,
    extractedSources,
  };
  await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const baseUrl = process.argv[2] ?? "https://orbit.getaxiom.ca/";
  const outputRoot = process.argv[3] ?? path.resolve("recovery/evidence/live-assets");
  const manifest = await enumerateLiveAssets(baseUrl, outputRoot);
  console.log(JSON.stringify({ baseUrl: manifest.baseUrl, records: manifest.records.length, saved: manifest.records.filter((record) => record.saved).length, maps: manifest.records.filter((record) => record.requestedUrl.endsWith(".map")).length }, null, 2));
}
