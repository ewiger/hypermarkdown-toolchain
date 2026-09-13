#!/usr/bin/env node
// Verify built release archives.
//
//   node scripts/verify-release.mjs [--out dist]
//
// Checks every archive in the output directory: its digest matches SHA256SUMS,
// it contains exactly the three files the layout promises, its embedded
// manifest agrees with toolchain.json, and — for the archive matching the host
// — the extracted d2 actually runs and renders. Both workflows call this, so
// there is one definition of "a good release" rather than a copy in each.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, fail, parseSums, readManifest, sha256 } from "./lib/common.mjs";
import { readTarGz } from "./lib/tar.mjs";
import { readZip } from "./lib/zip.mjs";

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function hostPlatform() {
  const os = { linux: "linux", darwin: "macos", win32: "windows" }[process.platform];
  const arch = { x64: "x86_64", arm64: "arm64" }[process.arch];
  return os && arch ? `${os}-${arch}` : null;
}

/** Run the extracted binary the way its consumers do, and confirm what it is. */
function exerciseBinary(entry, expectedVersion) {
  const dir = mkdtempSync(join(tmpdir(), "hmd-toolchain-"));
  // The extension matters on Windows: CreateProcess will not execute a file
  // without one, so a binary written as plain `d2` fails here with ENOENT and
  // reads as a missing file rather than as the naming mistake it is.
  const binary = join(dir, process.platform === "win32" ? "d2.exe" : "d2");
  writeFileSync(binary, entry.body);
  chmodSync(binary, 0o755);

  const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  check(
    version.includes(expectedVersion),
    `d2 --version reported ${JSON.stringify(version)}, expected it to contain ${expectedVersion}`,
  );

  // `d2 - -` (stdin to stdout) is the exact invocation both the mkdocs plugin
  // and the VS Code extension use, so it is the one worth proving.
  const svg = execFileSync(binary, ["-", "-"], { input: "a -> b\n", encoding: "utf8", timeout: 30_000 });
  check(svg.includes("<svg"), "rendering `a -> b` through `d2 - -` produced no SVG");

  return version;
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const out = join(ROOT, outIndex === -1 ? "dist" : process.argv[outIndex + 1]);

  const manifest = await readManifest();
  const expectedSums = parseSums(await readFile(join(out, "SHA256SUMS"), "utf8"));
  const host = hostPlatform();

  console.log(`verifying ${out} against toolchain ${manifest.toolchain} (d2 ${manifest.tools.d2.version})`);

  for (const platform of manifest.platforms) {
    const windows = platform.startsWith("windows-");
    const name = `hypermarkdown-toolchain-${manifest.toolchain}-${platform}` + (windows ? ".zip" : ".tar.gz");

    const body = await readFile(join(out, name)).catch(() => null);
    if (body === null) {
      problems.push(`${name}: missing from ${out}`);
      continue;
    }

    check(expectedSums[name] === sha256(body), `${name}: does not match its SHA256SUMS entry`);

    const entries = (windows ? readZip(body) : readTarGz(body)).filter((entry) => entry.type !== "5");
    const binaryPath = windows ? "bin/d2.exe" : "bin/d2";
    const names = entries.map((entry) => entry.name).sort();
    check(
      JSON.stringify(names) === JSON.stringify([binaryPath, "licenses/d2/LICENSE", "manifest.json"].sort()),
      `${name}: unexpected contents ${names.join(", ")}`,
    );

    const binary = entries.find((entry) => entry.name === binaryPath);
    const embedded = entries.find((entry) => entry.name === "manifest.json");
    if (!binary || !embedded) continue;

    check((binary.mode & 0o111) !== 0, `${name}: ${binaryPath} is not executable`);

    const parsed = JSON.parse(embedded.body.toString("utf8"));
    check(parsed.toolchain === manifest.toolchain, `${name}: manifest toolchain ${parsed.toolchain}`);
    check(parsed.platform === platform, `${name}: manifest platform ${parsed.platform}`);
    check(parsed.tools.d2.version === manifest.tools.d2.version, `${name}: manifest d2 ${parsed.tools.d2.version}`);
    check(parsed.tools.d2.path === binaryPath, `${name}: manifest path ${parsed.tools.d2.path}`);
    check(
      parsed.tools.d2.upstream.sha256 === manifest.tools.d2.assets[platform].sha256,
      `${name}: manifest records a different upstream digest than toolchain.json`,
    );

    if (platform === host) {
      const version = exerciseBinary(binary, manifest.tools.d2.version);
      console.log(`  ${name}  ran here: ${version}`);
    } else {
      console.log(`  ${name}  ok (not runnable on ${host ?? process.platform})`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    fail(`${problems.length} problem(s) found`);
  }

  console.log("all archives verified");
}

await main();
