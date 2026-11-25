// What each pinned tool contributes to an archive, shared by the build and the
// verifier so the two cannot disagree about a layout.
//
// A tool appears in a platform's archive exactly when toolchain.json pins an
// asset for that platform. d2, hmd-lsp and merman-cli publish all five; hql
// publishes four, and the Linux ARM64 archive simply carries no hql — a
// consumer falls back to PATH there.

/** The tools pinned for a platform, in a stable order. */
export function toolsFor(manifest, platform) {
  return Object.keys(manifest.tools)
    .sort()
    .filter((tool) => manifest.tools[tool].assets[platform] !== undefined);
}

export function binaryPath(tool, platform) {
  return platform.startsWith("windows-") ? `bin/${tool}.exe` : `bin/${tool}`;
}

export function licensePath(tool) {
  return `licenses/${tool}/LICENSE`;
}

/**
 * Where a tool's third-party notices go, for a tool that pins a `notices`
 * file. merman-cli links layout engines under other licences than its own, and
 * its archive names them in one file that has to travel with the binary.
 */
export function noticesPath(tool) {
  return `licenses/${tool}/THIRD_PARTY_NOTICES.md`;
}

/** Every file a platform's archive holds, sorted. */
export function expectedFiles(manifest, platform) {
  const files = ["manifest.json"];
  for (const tool of toolsFor(manifest, platform)) {
    files.push(binaryPath(tool, platform), licensePath(tool));
    if (manifest.tools[tool].notices !== undefined) files.push(noticesPath(tool));
  }
  return files.sort();
}
