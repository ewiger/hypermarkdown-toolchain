# Changelog

Toolchain versions are independent of HyperMarkDown's. A published release is
immutable.

## [Unreleased]

### Fixed

- **The archives are now byte-identical across build hosts, not only across
  builds on one host.** Byte 9 of a gzip header names the OS zlib was built
  for — `0x03` on Linux, `0x13` on Darwin — so building 0.1.0 on macOS produced
  five different digests than the Linux build CI published, while both passed
  the rebuild-and-compare check because each compared against itself. The byte
  is now pinned to `0xff`, "unknown", which makes the output a function of
  `toolchain.json` alone. Nothing reads the byte; the claim in the README is
  what was wrong, and it is now true.

  The published 0.1.0 archives are unaffected and stay valid — a release is
  immutable, and their contents were never in question: the inner tar was
  already identical, and consumers pin the published digests.

## [0.1.0] — 2026-09-14

First release.

- Pins d2 to 0.9.0 (`d2lang/d2` `v0.9.0`), replacing the unpinned
  `terrastruct/d2:latest` acquisition HyperMarkDown used in CI, in the docs
  build and in the VS Code extension.
- Publishes reproducible archives for linux-x86_64, linux-arm64, macos-x86_64,
  macos-arm64 and windows-x86_64, each with `bin/d2`, upstream's MPL-2.0 licence
  text, and a `manifest.json` recording the toolchain version, the d2 version and
  the upstream digest it was built from.
