#!/usr/bin/env node
// Build the hypermarkdown-toolchain release archives.
//
//   node scripts/build-release.mjs [--platform <id>]... [--out dist]
//
// Downloads the pinned upstream d2 assets, verifies them twice over, and
// repacks each into an archive with a stable internal layout. Output is
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
 * Find the single d2 executable in an extracted upstream tarball. Upstream
 * currently nests it at `d2-v<version>/bin/d2`, but searching by name means a
 * layout change surfaces as a clear failure here rather than as an archive that
 * is missing its binary.
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
  // d2 is MPL-2.0, not MIT like this repo, so redistributing the binary means
  // shipping upstream's licence text alongside it.
  const match = entries.find((entry) => /(^|\/)LICENSE(\.[A-Za-z]+)?$/.test(entry.name) && entry.type === "0");
  if (!match) fail("no LICENSE file found in the upstream archive");
  return match;
}

async function buildPlatform(manifest, platform, outDir) {
  const d2 = manifest.tools.d2;
  const asset = d2.assets[platform];
  if (!asset) fail(`no pinned asset for platform ${platform}`);

  const url = releaseAssetUrl(d2.upstream.repo, d2.upstream.tag, asset.name);
  const upstreamArchive = await fetchAssetCached(url, asset.name, asset.sha256);

  // First check: the bytes we hold match the digest recorded in toolchain.json.
  // This is the pin — it fails if upstream ever moves the tag.
  const actual = sha256(upstreamArchive);
  if (actual !== asset.sha256) {
    fail(`${asset.name}: pinned sha256 ${asset.sha256}, downloaded ${actual}`);
  }

  const entries = readTarGz(upstreamArchive);
  const executable = findExecutable(entries, "d2");
  const license = findLicense(entries);

  const windows = platform.startsWith("windows-");
  const binaryPath = windows ? "bin/d2.exe" : "bin/d2";

  // No build timestamp and no builder identity: the manifest describes the
  // inputs, which is what makes rebuilding reproducible.
  const archiveManifest = {
    toolchain: manifest.toolchain,
    platform,
    tools: {
      d2: {
        version: d2.version,
        path: binaryPath,
        upstream: {
          repo: d2.upstream.repo,
          tag: d2.upstream.tag,
          asset: asset.name,
          sha256: asset.sha256,
        },
      },
    },
  };

  const files = [
    { name: binaryPath, mode: ARCHIVE_MODE, body: executable.body },
    { name: "licenses/d2/LICENSE", mode: LICENSE_MODE, body: license.body },
    { name: "manifest.json", mode: LICENSE_MODE, body: Buffer.from(`${JSON.stringify(archiveManifest, null, 2)}\n`) },
  ];

  const base = `hypermarkdown-toolchain-${manifest.toolchain}-${platform}`;
  const name = windows ? `${base}.zip` : `${base}.tar.gz`;
  const body = windows ? writeZip(files) : writeTarGz(files);

  await writeFile(join(outDir, name), body);
  console.log(`  ${name}  (${(body.length / 1024 / 1024).toFixed(1)} MiB)`);

  return [name, sha256(body)];
}

async function main() {
  const { platforms: requested, out } = parseArgs(process.argv.slice(2));
  const manifest = await readManifest();
  const platforms = requested.length > 0 ? requested : manifest.platforms;

  for (const platform of platforms) {
    if (!manifest.platforms.includes(platform)) fail(`unknown platform: ${platform}`);
  }

  // Second check, independent of the pin: upstream's own SHA256SUMS must agree
  // with what toolchain.json records. A mismatch means the pins were written
  // wrong, or that this tag is not the one they were taken from.
  const d2 = manifest.tools.d2;
  const sumsUrl = releaseAssetUrl(d2.upstream.repo, d2.upstream.tag, "SHA256SUMS");
  const upstreamSums = parseSums((await fetchBuffer(sumsUrl)).toString("utf8"));

  for (const platform of platforms) {
    const asset = d2.assets[platform];
    const published = upstreamSums[asset.name];
    if (!published) fail(`${asset.name} is not listed in ${d2.upstream.tag} SHA256SUMS`);
    if (published !== asset.sha256) {
      fail(`${asset.name}: toolchain.json pins ${asset.sha256}, upstream publishes ${published}`);
    }
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  console.log(`hypermarkdown-toolchain ${manifest.toolchain} (d2 ${d2.version}, ${d2.upstream.tag})`);

  const sums = [];
  for (const platform of platforms) sums.push(await buildPlatform(manifest, platform, out));

  await writeFile(join(out, "SHA256SUMS"), formatSums(sums));
  console.log(`  SHA256SUMS`);
}

await main();
