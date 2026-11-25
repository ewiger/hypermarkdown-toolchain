#!/usr/bin/env node
// Verify built release archives.
//
//   node scripts/verify-release.mjs [--out dist]
//
// Checks every archive in the output directory: its digest matches SHA256SUMS,
// it contains exactly the files the layout promises for its platform, its
// embedded manifest agrees with toolchain.json, and — for the archive matching
// the host — every extracted binary actually runs: d2 renders, hql runs a
// cell, hmd-lsp answers a client, and merman-cli draws a Mermaid diagram. Both
// workflows call this, so there is one definition of "a good release" rather
// than a copy in each.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

/** One Language Server Protocol message, framed as the protocol frames it. */
function frame(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/** The messages in a server's output, in the order it wrote them. */
function unframe(output) {
  const messages = [];
  let rest = Buffer.from(output, "utf8");
  for (;;) {
    const head = rest.indexOf("\r\n\r\n");
    if (head === -1) return messages;
    const length = /Content-Length: (\d+)/i.exec(rest.subarray(0, head).toString("utf8"));
    if (length === null) return messages;
    const start = head + 4;
    const end = start + Number(length[1]);
    messages.push(JSON.parse(rest.subarray(start, end).toString("utf8")));
    rest = rest.subarray(end);
  }
}

EXERCISE["hmd-lsp"] = (binary, expectedVersion, dir) => {
  const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  check(
    version === `hmd-lsp ${expectedVersion}`,
    `hmd-lsp --version reported ${JSON.stringify(version)}, expected "hmd-lsp ${expectedVersion}"`,
  );
  // One whole session over stdin and stdout, as the extension starts it:
  // `--stdio`, diagnostics off, a card opened, its tokens asked for, and a
  // clean stop. The card links to a card that exists and to one that does
  // not, so the answer shows the server resolved against the vault on disk.
  const vault = join(dir, "lsp-vault");
  mkdirSync(join(vault, ".hmd"), { recursive: true });
  writeFileSync(join(vault, "tokens.hmd"), "# Tokens\n");
  const uri = pathToFileURL(join(vault, "login.hmd")).href;
  const session = [
    { id: 1, method: "initialize", params: { capabilities: {}, initializationOptions: { diagnostics: false } } },
    { method: "initialized", params: {} },
    {
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "hmd", version: 1, text: "[[tokens]] [[nowhere]]\n" } },
    },
    { id: 2, method: "textDocument/semanticTokens/full", params: { textDocument: { uri } } },
    { id: 3, method: "shutdown", params: null },
    { method: "exit", params: null },
  ];
  const answers = unframe(
    execFileSync(binary, ["--stdio"], { input: session.map(frame).join(""), encoding: "utf8", timeout: 30_000 }),
  );
  const answer = (id) => answers.find((message) => message.id === id)?.result;
  check(
    answer(1)?.serverInfo?.name === "hmd-lsp" && answer(1)?.serverInfo?.version === expectedVersion,
    `hmd-lsp introduced itself as ${JSON.stringify(answer(1)?.serverInfo)}`,
  );
  // Two tokens: `tokens` resolves, and `nowhere` carries the first modifier,
  // which the server's legend names `unresolved`.
  check(
    JSON.stringify(answer(2)?.data) === JSON.stringify([0, 2, 6, 0, 0, 0, 11, 7, 0, 1]),
    `hmd-lsp answered semantic tokens ${JSON.stringify(answer(2)?.data)}`,
  );
  check(
    answer(1)?.capabilities?.semanticTokensProvider?.legend?.tokenModifiers?.[0] === "unresolved",
    "hmd-lsp's first token modifier is not `unresolved`",
  );
  return version;
};

EXERCISE["merman-cli"] = (binary, expectedVersion) => {
  const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  check(
    version === `merman-cli ${expectedVersion}`,
    `merman-cli --version reported ${JSON.stringify(version)}, expected "merman-cli ${expectedVersion}"`,
  );
  // The arguments HyperMarkDown draws a Mermaid diagram with: the source on
  // stdin, SVG on stdout, labels as SVG text, the resource policy for input
  // nobody vetted, and the renderer's own deadline.
  const args = [
    "render",
    "-",
    "--format",
    "svg",
    "--svg-pipeline",
    "resvg-safe",
    "--resource-profile",
    "constrained",
    "--operation-timeout-ms",
    "2000",
    "--quiet",
  ];
  const draw = (source) => execFileSync(binary, args, { input: source, encoding: "utf8", timeout: 30_000 });
  const source = "flowchart LR\n  A[Card on disk] -->|parse| B{Has cells?}\n";
  const svg = draw(source);
  check(svg.startsWith("<svg"), "drawing a flowchart through `merman-cli render -` produced no SVG");
  // The drawing is shown as an image, which does not show HTML inside
  // `foreignObject`: a label drawn that way arrives as an empty box.
  check(!svg.includes("<foreignObject"), "merman-cli drew a label as HTML in a foreignObject");
  check(/<text[^>]*>Card on disk<\/text>/.test(svg), "merman-cli did not draw the node label as SVG text");
  check(!svg.includes("<script"), "merman-cli wrote a script element into the SVG");
  // A site build and an editor must agree on a drawing, byte for byte.
  check(draw(source) === svg, "merman-cli drew the same source differently the second time");
  return version;
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
