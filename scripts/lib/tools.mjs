// What each pinned tool contributes to an archive, shared by the build and the
// verifier so the two cannot disagree about a layout.
//
// A tool appears in a platform's archive exactly when toolchain.json pins an
// asset for that platform. d2 publishes all five; hql publishes three, and the
// other two archives simply carry no hql — a consumer falls back to PATH there.

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

/** Every file a platform's archive holds, sorted. */
export function expectedFiles(manifest, platform) {
  const files = ["manifest.json"];
  for (const tool of toolsFor(manifest, platform)) {
    files.push(binaryPath(tool, platform), licensePath(tool));
  }
  return files.sort();
}
