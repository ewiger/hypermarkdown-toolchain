# hypermarkdown-toolchain

Pinned native binaries for [HyperMarkDown](https://github.com/ewiger/hypermarkdown).

HyperMarkDown needs [`d2`](https://github.com/d2lang/d2) to render diagrams — in
CI, in the documentation build, and inside the VS Code extension. Before this
repository existed each of those acquired it separately from a moving `:latest`
Docker tag, so two runs could render the same diagram differently and nothing
recorded why. This repository is the single distribution boundary that replaces
them: one pinned version, one reproducible archive per platform, one checksum
file.

It packages only native executable dependencies. The `hmd` CLI, the HMD LSP, the
`hql` CLI and the VS Code extension are first-party HyperMarkDown components and
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

Each archive has the same three-file layout, so a consumer that can unpack one
can unpack all of them:

```text
bin/d2                 # bin/d2.exe on Windows
licenses/d2/LICENSE    # d2 is MPL-2.0; the binary travels with its licence
manifest.json          # toolchain version, platform, d2 version and upstream pin
```

`manifest.json` describes the inputs rather than the build — no timestamp, no
builder identity — which is what makes the archives byte-reproducible. Building
the same `toolchain.json` twice produces an identical `SHA256SUMS`, and CI checks
that on every push.

## Consuming a release

Download the archive for your platform, verify it against `SHA256SUMS`, unpack
it, and use `bin/d2`. Nothing here is meant to be consumed as source: HyperMarkDown
pins a toolchain *version* and fetches the published artifact over HTTPS.

The two version lines are independent. Bumping d2 happens here; HyperMarkDown
bumps only the toolchain version it pins, and a published toolchain release is
immutable.

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
pinned in `toolchain.json`, and once against the `SHA256SUMS` upstream publishes
for that tag. The first catches a moved tag; the second catches a pin that was
written wrong to begin with.

`verify-release.mjs` is the single definition of a good release — both workflows
call it rather than each describing the checks themselves. It confirms every
digest, the exact file list, the executable bit, and that the embedded manifest
agrees with `toolchain.json`; and for the archive matching the host it extracts
`d2` and renders `a -> b` through `d2 - -`, the invocation the mkdocs plugin and
the extension actually use.

## Releasing

1. `node scripts/bump-d2.mjs <tag>` if d2 is moving.
2. Bump `toolchain` in `toolchain.json` and add a `CHANGELOG.md` entry.
3. Tag `v<version>`. The release workflow rejects a tag that disagrees with
   `toolchain.json`, builds, verifies on all five platforms, and publishes.

## Licence

This repository is MIT ([LICENSE](LICENSE)). The `d2` binary it redistributes is
MPL-2.0 and ships with upstream's licence text at `licenses/d2/LICENSE` inside
every archive.
