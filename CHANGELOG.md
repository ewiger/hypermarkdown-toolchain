# Changelog

Toolchain versions are independent of HyperMarkDown's. A published release is
immutable.

## [0.1.0] — 2026-09-14

First release.

- Pins d2 to 0.9.0 (`d2lang/d2` `v0.9.0`), replacing the unpinned
  `terrastruct/d2:latest` acquisition HyperMarkDown used in CI, in the docs
  build and in the VS Code extension.
- Publishes reproducible archives for linux-x86_64, linux-arm64, macos-x86_64,
  macos-arm64 and windows-x86_64, each with `bin/d2`, upstream's MPL-2.0 licence
  text, and a `manifest.json` recording the toolchain version, the d2 version and
  the upstream digest it was built from.
