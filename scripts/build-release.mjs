#!/usr/bin/env node
// Build the hypermarkdown-toolchain release archives.
//
//   node scripts/build-release.mjs [--platform <id>]... [--out dist]
//
// Downloads the pinned upstream assets of every tool — d2 and hql — verifies
// them twice over, and repacks them into one archive per platform with a
// stable internal layout. Output is
// byte-reproducible: given the same toolchain.json, two runs produce identical
// archives and an identical SHA256SUMS.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CACHE_DIR,
  ROOT,
  fail,
  fetchAssetCached,
  fetchBuffer,
  formatSums,
  parseSums,
  readManifest,
  releaseAssetUrl,
  sha256,
} from "./lib/common.mjs";
import { readTarGz, writeTarGz } from "./lib/tar.mjs";
import { binaryPath, licensePath, toolsFor } from "./lib/tools.mjs";
import { writeZip } from "./lib/zip.mjs";

const ARCHIVE_MODE = 0o755;
const LICENSE_MODE = 0o644;

function parseArgs(argv) {
  const platforms = [];
  let out = join(ROOT, "dist");

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform") platforms.push(argv[++i]);
    else if (argv[i] === "--out") out = join(ROOT, argv[++i]);
    else fail(`unknown argument: ${argv[i]}`);
  }

  return { platforms, out };
}

/**
 * Find a tool's single executable in an extracted upstream tarball. d2 nests it
 * at `d2-v<version>/bin/d2` and hql at `hql-v<version>-<target>/hql`; searching
 * by name means a layout change surfaces as a clear failure here rather than as
 * an archive that is missing its binary.
 */
function findExecutable(entries, tool) {
  const matches = entries.filter((entry) => {
    const base = entry.name.split("/").pop();
    return entry.type === "0" && (base === tool || base === `${tool}.exe`);
  });

  if (matches.length !== 1) {
    fail(
      `expected exactly one \`${tool}\` executable in the upstream archive, found ${matches.length}` +
        ` — upstream layout changed, adjust findExecutable()`,
    );
  }

  return matches[0];
}

function findLicense(entries) {
  // d2 is MPL-2.0 and hql is MIT, not this repo's licence, so redistributing a
  // binary means shipping upstream's licence text alongside it.
  const match = entries.find((entry) => /(^|\/)LICENSE(\.[A-Za-z]+)?$/.test(entry.name) && entry.type === "0");
  if (!match) fail("no LICENSE file found in the upstream archive");
  return match;
}

/** One tool's binary and licence for one platform, verified against its pin. */
async function toolFiles(manifest, tool, platform) {
  const spec = manifest.tools[tool];
  const asset = spec.assets[platform];
  const url = releaseAssetUrl(spec.upstream.repo, spec.upstream.tag, asset.name);
  const upstreamArchive = await fetchAssetCached(url, asset.name, asset.sha256);

  // First check: the bytes we hold match the digest recorded in toolchain.json.
  // This is the pin — it fails if upstream ever moves the tag.
  const actual = sha256(upstreamArchive);
  if (actual !== asset.sha256) {
    fail(`${asset.name}: pinned sha256 ${asset.sha256}, downloaded ${actual}`);
  }

  const entries = readTarGz(upstreamArchive);
  const path = binaryPath(tool, platform);
  return {
    files: [
      { name: path, mode: ARCHIVE_MODE, body: findExecutable(entries, tool).body },
      { name: licensePath(tool), mode: LICENSE_MODE, body: findLicense(entries).body },
    ],
    entry: {
      version: spec.version,
      path,
      license: spec.license,
      upstream: {
        repo: spec.upstream.repo,
        tag: spec.upstream.tag,
        asset: asset.name,
        sha256: asset.sha256,
      },
    },
  };
}

async function buildPlatform(manifest, platform, outDir) {
  const tools = toolsFor(manifest, platform);
  if (!tools.includes("d2")) fail(`no pinned d2 asset for platform ${platform}`);

  const files = [];
  const entries = {};
  for (const tool of tools) {
    const built = await toolFiles(manifest, tool, platform);
    files.push(...built.files);
    entries[tool] = built.entry;
  }

  // No build timestamp and no builder identity: the manifest describes the
  // inputs, which is what makes rebuilding reproducible.
  const archiveManifest = { toolchain: manifest.toolchain, platform, tools: entries };
  files.push({
    name: "manifest.json",
    mode: LICENSE_MODE,
    body: Buffer.from(`${JSON.stringify(archiveManifest, null, 2)}\n`),
  });

  const windows = platform.startsWith("windows-");
  const base = `hypermarkdown-toolchain-${manifest.toolchain}-${platform}`;
  const name = windows ? `${base}.zip` : `${base}.tar.gz`;
  const body = windows ? writeZip(files) : writeTarGz(files);

  await writeFile(join(outDir, name), body);
  console.log(`  ${name}  ${tools.join(", ")}  (${(body.length / 1024 / 1024).toFixed(1)} MiB)`);

  return [name, sha256(body)];
}

/**
 * The digests upstream itself publishes for a tool's assets: one `SHA256SUMS`
 * for the release (d2), or a `<asset>.sha256` beside each asset (hql).
 */
async function upstreamSums(spec, platforms) {
  const { repo, tag } = spec.upstream;
  if (spec.checksums === "SHA256SUMS") {
    return parseSums((await fetchBuffer(releaseAssetUrl(repo, tag, "SHA256SUMS"))).toString("utf8"));
  }
  if (spec.checksums === "sidecar") {
    const sums = {};
    for (const platform of platforms) {
      const asset = spec.assets[platform];
      if (asset === undefined) continue;
      const text = (await fetchBuffer(releaseAssetUrl(repo, tag, `${asset.name}.sha256`))).toString("utf8");
      Object.assign(sums, parseSums(text));
    }
    return sums;
  }
  fail(`unknown checksums kind ${JSON.stringify(spec.checksums)}`);
}

async function main() {
  const { platforms: requested, out } = parseArgs(process.argv.slice(2));
  const manifest = await readManifest();
  const platforms = requested.length > 0 ? requested : manifest.platforms;

  for (const platform of platforms) {
    if (!manifest.platforms.includes(platform)) fail(`unknown platform: ${platform}`);
  }

  // Second check, independent of the pin: upstream's own published digests
  // must agree with what toolchain.json records. A mismatch means the pins were
  // written wrong, or that this tag is not the one they were taken from.
  for (const [tool, spec] of Object.entries(manifest.tools)) {
    const sums = await upstreamSums(spec, platforms);
    for (const platform of platforms) {
      const asset = spec.assets[platform];
      if (asset === undefined) continue;
      const published = sums[asset.name];
      if (!published) fail(`${tool}: ${asset.name} has no published digest in ${spec.upstream.tag}`);
      if (published !== asset.sha256) {
        fail(`${asset.name}: toolchain.json pins ${asset.sha256}, upstream publishes ${published}`);
      }
    }
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const pins = Object.entries(manifest.tools).map(([tool, spec]) => `${tool} ${spec.version}`);
  console.log(`hypermarkdown-toolchain ${manifest.toolchain} (${pins.join(", ")})`);

  const sums = [];
  for (const platform of platforms) sums.push(await buildPlatform(manifest, platform, out));

  await writeFile(join(out, "SHA256SUMS"), formatSums(sums));
  console.log(`  SHA256SUMS`);
}

await main();
