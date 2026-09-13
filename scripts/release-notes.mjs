#!/usr/bin/env node
// Print the CHANGELOG section for one version.
//
//   node scripts/release-notes.mjs 0.1.0
//
// The release workflow feeds this to `gh release create`. It lives here rather
// than inline in the YAML because the extraction is a regular expression over
// markdown, and a regular expression that has to survive YAML, shell and `-e`
// quoting is one nobody can read or test.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT, fail } from "./lib/common.mjs";

const version = process.argv[2];
if (!version) fail("usage: node scripts/release-notes.mjs <version>");

const text = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");
const heading = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*$`, "m");
const start = heading.exec(text);

// An unreleased or missing section is not worth failing a publication over —
// the workflow falls back to pointing at the changelog.
if (!start) process.exit(0);

const rest = text.slice(start.index + start[0].length);
const next = /^## /m.exec(rest);
process.stdout.write(`${(next ? rest.slice(0, next.index) : rest).trim()}\n`);
