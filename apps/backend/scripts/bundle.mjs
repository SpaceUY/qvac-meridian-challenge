import { bundleSdk, verifyBundle, formatVerifyBundleResult } from "@qvac/sdk/commands";
import { statSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(backendDir, "..", "..");

// Mirrors @qvac/sdk's own `DEFAULT_HOSTS` (dist/commands/bundle/constants.js) -
// not re-exported from the public `@qvac/sdk/commands` entrypoint, so it's
// duplicated here. This is the host set `bundleSdk()` bundles prebuilt native
// addons for whenever a call omits its own `hosts` option (both calls below
// do), so verifying against the same set checks what was actually bundled.
const ALL_HOSTS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
  "android-arm64",
  "ios-arm64",
  "ios-arm64-simulator",
  "ios-x64-simulator",
];

function dirSizeBytes(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(full) : statSync(full).size;
  }
  return total;
}

// IMPORTANT: both `bundleSdk()` calls below write to the same output
// directory - `<projectRoot>/qvac/` - because the SDK keys its output dir
// only on `projectRoot`, not `configPath` (confirmed in the installed SDK:
// `outputDir = path.join(projectRoot, 'qvac')`, `dist/commands/bundle/index.js`).
// So whichever build runs LAST is the one left on disk at `repoRoot/qvac/`.
// We want that to be the plugin-scoped (tree-shaken) bundle - that's the
// actual Req 6.2.2 deliverable and what `apps/backend/README.md` promises
// ("Output goes to `qvac/` at the repo root") - so the full-SDK comparison
// build runs FIRST and is measured immediately, before the scoped build
// overwrites it. This also means no snapshot/temp copy is needed for the
// scoped side: it's simply the last thing written, so it's still there
// (unmodified) when we measure and verify it below.
const fullConfigDir = mkdtempSync(join(tmpdir(), "qvac-full-config-"));
try {
  console.log("[bundle] building a full-SDK bundle for comparison (every builtin plugin)...");
  const fullConfigPath = join(fullConfigDir, "qvac.config.full.mjs");
  // No `plugins` key at all = the SDK's documented default: every builtin plugin included.
  writeFileSync(fullConfigPath, "export default { cacheDirectory: process.cwd() + '/.qvac-cache' };\n");
  const full = await bundleSdk({ projectRoot: repoRoot, configPath: fullConfigPath });
  // Measure NOW, before the scoped build below overwrites `repoRoot/qvac/`.
  const fullBytes = dirSizeBytes(dirname(full.bundlePath));

  console.log("[bundle] building the plugin-scoped bundle (this project's real qvac.config.mjs)...");
  const scoped = await bundleSdk({
    projectRoot: repoRoot,
    configPath: join(backendDir, "qvac.config.mjs"),
  });
  // Nothing overwrites `repoRoot/qvac/` after this point, so this measurement
  // reflects exactly what's left on disk once the script finishes.
  const scopedBytes = dirSizeBytes(dirname(scoped.bundlePath));

  // `scoped.bundlePath` is the final, persisted `worker.bundle.js` - verify it
  // directly, no snapshot needed.
  //
  // NOTE on verifyBundle()'s real option shape (differs from an earlier,
  // unconfirmed guess: `{ bundlePath }` alone is NOT enough). Per the installed
  // SDK's own `dist/commands/verify/index.d.ts`, `VerifyBundleOptions` is
  // `{ projectRoot: string; addonsSource: string; hosts: string[]; configPath?; bareRuntimeVersion? }`.
  // `addonsSource` is a path to either a bare-pack bundle *file* or a
  // node_modules directory - it auto-detects which by `fs.stat`. Pointing it at
  // `worker.bundle.js` selects the bare-pack-bundle path.
  const scopedVerify = await verifyBundle({
    projectRoot: repoRoot,
    addonsSource: scoped.bundlePath,
    hosts: ALL_HOSTS,
  });
  console.log(formatVerifyBundleResult(scopedVerify));

  const report = `# Bundle size report (Req 6.2.2)

Model weights are excluded from both builds - they're fetched at runtime by
\`npm run models:fetch\` / \`loadModel()\` and were never part of an "installer"
in the first place (Req 1.2's own parenthetical: "model weights shouldn't
count toward the installer size").

| Build | Plugins | Addons | Size on disk |
|---|---|---|---|
| Plugin-scoped (this product) | ${scoped.plugins.join(", ")} | ${scoped.addons.join(", ") || "(none detected - see note below)"} | ${(scopedBytes / 1024 / 1024).toFixed(1)} MB |
| Full SDK (all builtin plugins) | ${full.plugins.join(", ")} | ${full.addons.join(", ") || "(none detected - see note below)"} | ${(fullBytes / 1024 / 1024).toFixed(1)} MB |

Reduction: ${(100 * (1 - scopedBytes / fullBytes)).toFixed(0)}%.

${
  scoped.addons.length === 0 && full.addons.length === 0
    ? `**Note on the empty Addons columns:** \`@qvac/sdk@0.18.2\`'s addon-manifest generator
(\`generateAddonsManifest\` / \`buildNestedPathIndex\` in \`dist/commands/bundle/manifest.js\`,
shared by \`verifyBundle()\`'s bundle-source collector) resolves each native addon's
\`package.json\` from the bare-pack bundle's own resolution-map paths (e.g.
\`../../node_modules/@qvac/asr-ggml/package.json\`) joined onto \`projectRoot\` directly. In
this repo's npm-workspaces layout (\`node_modules\` hoisted to the repo root, \`projectRoot\`
passed as that same repo root so the SDK's own \`require.resolve\` can find it) those joined
paths land two directories above the repo root, which don't exist, so every native-addon
package.json lookup silently fails - even though the bundle's resolution map does contain
this repo's real \`@qvac/*-ggml\` / \`@qvac/*-llamacpp\` packages (confirmed manually: 1187
resolutions found, including 13 for \`@qvac/asr-ggml\` alone, which does declare
\`"addon": true\`). This is an upstream path-resolution limitation in the installed SDK
version for this project layout, not a difference between the two builds - \`verifyBundle()\`'s
"passed for 0 addons" result above has the same root cause and should be read as
"nothing could be inspected," not "nothing native is present." The **Size on disk** column
above is unaffected: it's a real \`stat()\` of each build's output directory, not derived from
the addons list. Bare-pack bundles are JS-only in any case - native addon prebuilds
(\`node_modules/@qvac/*/prebuilds/\`) are loaded by Bare at runtime and aren't embedded in
\`worker.bundle.js\`, so this reduction reflects the tree-shaken JS driver/wrapper code for the
8 excluded plugins, not native binary size.\n\n`
    : ""
}Generated by \`npm run build --workspace=apps/backend\` (\`apps/backend/scripts/bundle.mjs\`).
`;
  writeFileSync(join(repoRoot, "docs", "bundle-size-report.md"), report);
  console.log(`[bundle] wrote docs/bundle-size-report.md (${(scopedBytes / 1024 / 1024).toFixed(1)} MB vs ${(fullBytes / 1024 / 1024).toFixed(1)} MB full)`);
} finally {
  rmSync(fullConfigDir, { recursive: true, force: true });
}
