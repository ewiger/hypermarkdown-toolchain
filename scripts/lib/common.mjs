import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const MANIFEST_PATH = join(ROOT, "toolchain.json");

/** Where downloaded upstream assets are cached between runs. Gitignored. */
export const CACHE_DIR = join(ROOT, "work", "cache");

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

export async function writeManifest(manifest) {
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function releaseAssetUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

export async function fetchBuffer(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch an upstream asset, reusing a cached copy when its digest already
 * matches. The digest is always checked, cached or not — a cache hit is a
 * shortcut past the download, never past verification.
 */
export async function fetchAssetCached(url, name, expectedSha256) {
  const cached = join(CACHE_DIR, name);
  let buf = await readFile(cached).catch(() => null);

  if (buf !== null && sha256(buf) !== expectedSha256) buf = null; // stale, refetch

  if (buf === null) {
    buf = await fetchBuffer(url);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cached, buf);
  }

  return buf;
}

/** Parse a `SHA256SUMS` body into { filename: digest }. */
export function parseSums(text) {
  const sums = {};
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match) sums[match[2]] = match[1];
  }
  return sums;
}

/** Render a `SHA256SUMS` body, in the order given. */
export function formatSums(entries) {
  return entries.map(([name, digest]) => `${digest}  ${name}\n`).join("");
}

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
