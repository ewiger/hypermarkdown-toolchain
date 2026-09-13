#!/usr/bin/env node
// Repin d2 to a new upstream release.
//
//   node scripts/bump-d2.mjs v0.10.0
//
// Rewrites the `d2` block of toolchain.json — version, tag, asset names and all
// five checksums — from the digests upstream publishes for that tag. Bumping d2
// is meant to be one command; hand-copying five hashes is how a pin quietly
// stops matching what it claims to pin.
//
// The toolchain version itself is left alone: that is a human decision, and the
// release workflow checks it against the git tag.

import {
  fail,
  fetchBuffer,
  parseSums,
  readManifest,
  releaseAssetUrl,
  writeManifest,
} from "./lib/common.mjs";

// Our platform ids are the ones the artifacts use; upstream names x86_64
// "amd64". This is the only place the two vocabularies meet.
const UPSTREAM_ARCH = { "x86_64": "amd64", "arm64": "arm64" };

function upstreamAssetName(version, platform) {
  const [os, arch] = platform.split("-");
  return `d2-v${version}-${os}-${UPSTREAM_ARCH[arch]}.tar.gz`;
}

async function main() {
  const tag = process.argv[2];
  if (!tag) fail("usage: node scripts/bump-d2.mjs <upstream-tag>, e.g. v0.10.0");
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`expected a tag like v0.10.0, got: ${tag}`);

  const version = tag.slice(1);
  const manifest = await readManifest();
  const repo = manifest.tools.d2.upstream.repo;

  const sums = parseSums((await fetchBuffer(releaseAssetUrl(repo, tag, "SHA256SUMS"))).toString("utf8"));
  if (Object.keys(sums).length === 0) fail(`no checksums parsed from ${repo} ${tag} SHA256SUMS`);

  const assets = {};
  for (const platform of manifest.platforms) {
    const name = upstreamAssetName(version, platform);
    const digest = sums[name];
    if (!digest) fail(`${repo} ${tag} publishes no ${name} — this platform cannot be pinned`);
    assets[platform] = { name, sha256: digest };
  }

  const previous = manifest.tools.d2.version;
  manifest.tools.d2 = { version, upstream: { repo, tag }, assets };
  await writeManifest(manifest);

  console.log(`d2 ${previous} → ${version} (${repo} ${tag})`);
  for (const platform of manifest.platforms) console.log(`  ${platform}  ${assets[platform].sha256}`);
  console.log(`\ntoolchain version is still ${manifest.toolchain} — bump it before tagging a release.`);
}

await main();
