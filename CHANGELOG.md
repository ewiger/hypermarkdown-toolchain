# Changelog

Toolchain versions are independent of HyperMarkDown's. A published release is
immutable.

## [Unreleased]

## [0.5.2] — 2026-11-22

### Added

- **`hql` on Windows.** `hql` 0.7.2 (`ewiger/hql` `v0.7.2`), where 0.5.1
  carried 0.7.1, publishes `x86_64-pc-windows-msvc`, so the windows-x86_64
  archive carries `bin/hql.exe` beside `bin/d2.exe`. The Linux x86_64 and both
  macOS archives carry 0.7.2 as before; Linux ARM64 still carries `d2` only.
  A path an HQL program reads is written with `/` on every host, a card's
  path among them. The cell protocol is unchanged.

## [0.5.1] — 2026-11-16

### Changed

- **`hql` 0.7.1** (`ewiger/hql` `v0.7.1`), where 0.5.0 carried 0.7.0, in the
  same three archives. `import m` binds the module's name only, so a cell that
  called a non-prelude module's function bare after `import m` now writes
  `m.f(…)` or `from m import f`. The cell protocol is unchanged.

## [0.5.0] — 2026-11-15

### Changed

- **`hql` 0.7.0** (`ewiger/hql` `v0.7.0`), where 0.4.0 carried 0.6.0, in the
  same three archives. The cell protocol the VS Code extension drives is
  `--vault <dir> render --envelope json` as before, but `--vault` now names
  the vault root, the directory holding `.hmd/`: HQL reads the cards from the
  namespace root its `wiki` setting names, and refuses a directory inside a
  vault that holds no `.hmd/`. A vault that keeps its cards at its root states
  `wiki = "."`. References resolve through HyperMarkdown's own resolver, a
  project is configured by `.hql/config.toml` in place of `hql.toml`, and
  `--project` replaces `--workspace`.

## [0.4.0] — 2026-11-13

### Changed

- **`hql` 0.6.0** (`ewiger/hql` `v0.6.0`), where 0.3.0 carried 0.5.2, in the
  same three archives. The cell protocol the VS Code extension drives,
  `--vault <dir> render --envelope json`, is unchanged. The breaking changes
  are in the language: `Unit` is `Step`, a String's `length` is `size`,
  `net.socket` is `net.tcp`, and a configured id is declared under
  `[endpoint.<id>]` in `hql.toml`. `hql run`, `check`, `plan` and `boundary`
  find the vault from the program file's directory.
- Verification reads the first line of `hql --version`, since hql 0.6 adds a
  second naming its time-zone database.

## [0.3.0] — 2026-10-26

### Changed

- **`hql` 0.5.2** (`ewiger/hql` `v0.5.2`), where 0.2.0 carried 0.4.2, in the
  same three archives. Not a drop-in replacement: `--envelope json` carries a
  run's diagnostics under `diagnostics`, where it carried `reports`, and
  `--vault` refuses a directory holding neither `.hmd/` nor `hql.toml`.
- Verification runs the cell inside a vault with `.hmd/`, as the VS Code
  extension does, because hql 0.5 no longer accepts a bare directory.

## [0.2.0] — 2026-10-19

### Added

- **`hql` 0.4.2** (`ewiger/hql` `v0.4.2`), at `bin/hql` with its MIT licence at
  `licenses/hql/LICENSE`, in the linux-x86_64, macos-x86_64 and macos-arm64
  archives — the targets HQL publishes. The linux-arm64 and windows-x86_64
  archives carry `d2` only. `manifest.json` lists the tools an archive holds,
  each with its licence. Its digests are checked against the `.sha256` file HQL
  publishes beside each asset, as d2's are against its `SHA256SUMS`.
- Verification runs every binary on its own platform: `hql` runs a cell through
  `hql render --emit after --envelope json -`, the invocation the VS Code
  extension uses.

## [0.1.1] — 2026-09-14

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
