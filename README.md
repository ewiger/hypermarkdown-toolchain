# hypermarkdown-toolchain

Pinned native binaries for [HyperMarkDown](https://github.com/ewiger/hypermarkdown).

HyperMarkDown needs two native binaries:

- [`d2`](https://github.com/d2lang/d2) to render diagrams — in CI, in the
  documentation build, and inside the VS Code extension;
- [`hql`](https://github.com/ewiger/hql) to run HQL cells — inside the VS Code
  extension.

Before this repository existed `d2` was acquired separately in each place from a
moving `:latest` Docker tag, so two runs could render the same diagram
differently and nothing recorded why. This repository is the single
distribution boundary that replaces that: one pinned version per tool, one
reproducible archive per platform, one checksum file.

It packages only native executables released elsewhere. HQL is its own project
with its own releases, so to HyperMarkDown it is a pinned binary like `d2`. The
`hmd` CLI, the HMD LSP and the VS Code extension are HyperMarkDown components and
live in the main repository.

## What a release contains

Five archives and a `SHA256SUMS`:

```text
hypermarkdown-toolchain-0.1.0-linux-x86_64.tar.gz
hypermarkdown-toolchain-0.1.0-linux-arm64.tar.gz
hypermarkdown-toolchain-0.1.0-macos-x86_64.tar.gz
hypermarkdown-toolchain-0.1.0-macos-arm64.tar.gz
hypermarkdown-toolchain-0.1.0-windows-x86_64.zip
```

Each archive has the same layout, so a consumer that can unpack one can unpack
all of them:

```text
bin/d2                 # bin/d2.exe on Windows
bin/hql                # where HQL publishes this platform
licenses/d2/LICENSE    # d2 is MPL-2.0; each binary travels with its licence
licenses/hql/LICENSE   # hql is MIT
manifest.json          # toolchain version, platform, and each tool's version and upstream pin
```

A tool is in an archive exactly when `toolchain.json` pins an asset for that
platform. `d2` is in all five. HQL 0.7.0 publishes Linux x86_64 and both macOS
targets, so the Linux ARM64 and Windows archives carry `d2` only;
`manifest.json` lists what an archive holds.

`manifest.json` describes the inputs rather than the build — no timestamp, no
builder identity — which is what makes the archives byte-reproducible. Building
the same `toolchain.json` produces an identical `SHA256SUMS`, on any host: entry
mtimes, uids and modes are fixed, the gzip header carries no filename or
timestamp, and its OS byte is pinned rather than taken from the zlib the builder
happens to have. CI rebuilds and compares on every push.

## Consuming a release

Download the archive for your platform, verify it against `SHA256SUMS`, unpack
it, and use `bin/d2` and `bin/hql`. Nothing here is meant to be consumed as source: HyperMarkDown
pins a toolchain *version* and fetches the published artifact over HTTPS.

The version lines are independent. Bumping d2 or hql happens here;
HyperMarkDown bumps only the toolchain version it pins, and a published
toolchain release is immutable.

## Working on this repository

Node 22+, no dependencies — the tar and zip readers and writers are in
[scripts/lib/](scripts/lib/) precisely so that a release cannot depend on a
package that might change under it.

```bash
node scripts/build-release.mjs        # build every platform into dist/
node scripts/build-release.mjs --platform macos-arm64
node scripts/verify-release.mjs       # check what is in dist/
node scripts/bump-d2.mjs v0.10.0      # repin d2 to a new upstream release
```

`build-release.mjs` verifies the upstream assets twice: once against the digests
pinned in `toolchain.json`, and once against the digests upstream publishes for
that tag — a `SHA256SUMS` for d2, a `.sha256` beside each asset for hql. The first catches a moved tag; the second catches a pin that was
written wrong to begin with.

`verify-release.mjs` is the single definition of a good release — both workflows
call it rather than each describing the checks themselves. It confirms every
digest, the exact file list, the executable bit, and that the embedded manifest
agrees with `toolchain.json`; and for the archive matching the host it extracts
each binary and runs it the way its consumer does — `d2 - -` renders `a -> b`,
and `hql render --emit after --envelope json -` runs a cell.

## Releasing

1. `node scripts/bump-d2.mjs <tag>` if d2 is moving. To move hql, edit its
   `version`, `tag` and the three asset digests in `toolchain.json`; the build
   checks them against HQL's published `.sha256` files.
2. Bump `toolchain` in `toolchain.json` and add a `CHANGELOG.md` entry.
3. Tag `v<version>`. The release workflow rejects a tag that disagrees with
   `toolchain.json`, builds, verifies on all five platforms, and publishes.

## Licence

This repository is MIT ([LICENSE](LICENSE)). The `d2` binary it redistributes is
MPL-2.0 and ships with upstream's licence text at `licenses/d2/LICENSE`; the
`hql` binary is MIT and ships with its licence at `licenses/hql/LICENSE`.
