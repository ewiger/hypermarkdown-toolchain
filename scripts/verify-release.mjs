#!/usr/bin/env node
// Verify built release archives.
//
//   node scripts/verify-release.mjs [--out dist]
//
// Checks every archive in the output directory: its digest matches SHA256SUMS,
// it contains exactly the files the layout promises for its platform, its
// embedded manifest agrees with toolchain.json, and — for the archive matching
// the host — every extracted binary actually runs: d2 renders, and hql runs a
// cell. Both workflows call this, so
// there is one definition of "a good release" rather than a copy in each.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, fail, parseSums, readManifest, sha256 } from "./lib/common.mjs";
import { readTarGz } from "./lib/tar.mjs";
import { readZip } from "./lib/zip.mjs";
import { binaryPath, expectedFiles, toolsFor } from "./lib/tools.mjs";

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function hostPlatform() {
  const os = { linux: "linux", darwin: "macos", win32: "windows" }[process.platform];
  const arch = { x64: "x86_64", arm64: "arm64" }[process.arch];
  return os && arch ? `${os}-${arch}` : null;
}

/** Write an extracted binary somewhere it can run. */
function extract(entry, tool) {
  const dir = mkdtempSync(join(tmpdir(), "hmd-toolchain-"));
  // The extension matters on Windows: CreateProcess will not execute a file
  // without one, so a binary written as plain `d2` fails here with ENOENT and
  // reads as a missing file rather than as the naming mistake it is.
  const binary = join(dir, process.platform === "win32" ? `${tool}.exe` : tool);
  writeFileSync(binary, entry.body);
  chmodSync(binary, 0o755);
  return { binary, dir };
}

/**
 * Run each extracted binary the way its consumers do, and confirm what it is.
 * The invocations are the ones the mkdocs plugin and the VS Code extension
 * make, because those are the ones worth proving.
 */
const EXERCISE = {
  d2(binary, expectedVersion) {
    const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
    check(
      version.includes(expectedVersion),
      `d2 --version reported ${JSON.stringify(version)}, expected it to contain ${expectedVersion}`,
    );
    // `d2 - -`, stdin to stdout.
    const svg = execFileSync(binary, ["-", "-"], { input: "a -> b\n", encoding: "utf8", timeout: 30_000 });
    check(svg.includes("<svg"), "rendering `a -> b` through `d2 - -` produced no SVG");
    return version;
  },
  hql(binary, expectedVersion, dir) {
    // Since hql 0.6 a second line names the time-zone database; the version
    // is the first.
    const version = execFileSync(binary, ["--version"], { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    check(
      version.includes(expectedVersion),
      `hql --version reported ${JSON.stringify(version)}, expected it to contain ${expectedVersion}`,
    );
    // `hql render --emit after --envelope json -`, a card on stdin and one JSON
    // object back: how the extension runs a cell. Since hql 0.5 `--vault` must
    // name a real vault, one holding `.hmd/`, as every vault the extension
    // passes does. Since hql 0.8 the namespace root is `location_path`, which
    // defaults to the vault itself, so an empty `.hmd/` is a whole vault: the
    // one the editor's Initialize Vault creates, and the one checked here.
    const vault = join(dir, "vault");
    mkdirSync(join(vault, ".hmd"), { recursive: true });
    const card = "```hql#eval\n[1, 2] | map(x => x * 2)\n```\n";
    const answer = execFileSync(
      binary,
      ["--vault", vault, "render", "--emit", "after", "--envelope", "json", "-"],
      { input: card, encoding: "utf8", timeout: 30_000 },
    );
    const cell = JSON.parse(answer).cells?.[0];
    check(
      cell?.status === "ok" && cell?.markdown === "- 2\n- 4",
      `running a cell through \`hql render\` answered ${JSON.stringify(cell)}`,
    );
    return version;
  },
};

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const out = join(ROOT, outIndex === -1 ? "dist" : process.argv[outIndex + 1]);

  const manifest = await readManifest();
  const expectedSums = parseSums(await readFile(join(out, "SHA256SUMS"), "utf8"));
  const host = hostPlatform();

  const pins = Object.entries(manifest.tools).map(([tool, spec]) => `${tool} ${spec.version}`);
  console.log(`verifying ${out} against toolchain ${manifest.toolchain} (${pins.join(", ")})`);

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
    const names = entries.map((entry) => entry.name).sort();
    check(
      JSON.stringify(names) === JSON.stringify(expectedFiles(manifest, platform)),
      `${name}: unexpected contents ${names.join(", ")}`,
    );

    const embedded = entries.find((entry) => entry.name === "manifest.json");
    if (!embedded) continue;
    const parsed = JSON.parse(embedded.body.toString("utf8"));
    check(parsed.toolchain === manifest.toolchain, `${name}: manifest toolchain ${parsed.toolchain}`);
    check(parsed.platform === platform, `${name}: manifest platform ${parsed.platform}`);

    const tools = toolsFor(manifest, platform);
    check(
      JSON.stringify(Object.keys(parsed.tools ?? {}).sort()) === JSON.stringify(tools),
      `${name}: manifest lists ${Object.keys(parsed.tools ?? {}).join(", ")}, expected ${tools.join(", ")}`,
    );

    const ran = [];
    for (const tool of tools) {
      const path = binaryPath(tool, platform);
      const binary = entries.find((entry) => entry.name === path);
      const recorded = parsed.tools?.[tool];
      if (!binary || !recorded) continue;
      const spec = manifest.tools[tool];

      check((binary.mode & 0o111) !== 0, `${name}: ${path} is not executable`);
      check(recorded.version === spec.version, `${name}: manifest ${tool} ${recorded.version}`);
      check(recorded.path === path, `${name}: manifest ${tool} path ${recorded.path}`);
      check(
        recorded.upstream?.sha256 === spec.assets[platform].sha256,
        `${name}: manifest records a different upstream ${tool} digest than toolchain.json`,
      );

      if (platform === host) {
        const { binary: file, dir } = extract(binary, tool);
        ran.push(EXERCISE[tool](file, spec.version, dir));
      }
    }

    if (platform === host) {
      console.log(`  ${name}  ran here: ${ran.join("; ")}`);
    } else {
      console.log(`  ${name}  ok: ${tools.join(", ")} (not runnable on ${host ?? process.platform})`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    fail(`${problems.length} problem(s) found`);
  }

  console.log("all archives verified");
}

await main();
