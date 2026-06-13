/**
 * Zip the MV3 extension for Chrome/Edge sideload or Microsoft Edge Add-ons upload.
 * Edge Partner Center: description in manifest.json must be <= 132 characters.
 *
 * Usage: npm run package:extension
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertManifestResources } from "./extension-validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const EDGE_DESC_MAX = 132;

const extDir = path.join(root, "extension");
const manifestPath = path.join(extDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("[package-extension] extension/manifest.json missing");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = String(manifest.version || "0.0.0").trim();
const desc = String(manifest.description || "");
if (desc.length > EDGE_DESC_MAX) {
  console.error(
    `[package-extension] manifest description is ${desc.length} chars; Edge Add-ons max is ${EDGE_DESC_MAX}.`,
  );
  process.exit(1);
}

assertManifestResources(extDir, manifest, "package-extension");

const outDir = path.join(root, "rawengine", "production");
fs.mkdirSync(outDir, { recursive: true });

const zipName = `RawInvestor-TabCapture-extension-v${version}.zip`;
const edgeZipName = `RawInvestorEdgeExtension-v${version}.zip`;
const zipOut = path.join(outDir, zipName);
const edgeZipOut = path.join(outDir, edgeZipName);
const staging = path.join(outDir, `.ext-zip-staging-${version}`);

const SKIP_NAMES = new Set(["node_modules", ".git"]);
const SKIP_GLOB = /\.test\.(mjs|js)$/i;

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP_NAMES.has(name) || SKIP_GLOB.test(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function zipFolder(stagingDir, outZip) {
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  if (process.platform !== "win32") {
    console.warn("[package-extension] Non-Windows: zip manually from", stagingDir);
    return false;
  }
  const psEsc = (s) => s.replace(/'/g, "''");
  const cmd = `Compress-Archive -Path '${psEsc(stagingDir)}\\*' -DestinationPath '${psEsc(outZip)}' -Force`;
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], {
    stdio: "inherit",
    cwd: root,
  });
  return true;
}

try {
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  copyTree(extDir, staging);

  if (!zipFolder(staging, zipOut)) process.exit(0);

  fs.copyFileSync(zipOut, edgeZipOut);
  console.log(`[package-extension] Wrote ${path.relative(root, zipOut)}`);
  console.log(`[package-extension] Wrote ${path.relative(root, edgeZipOut)} (Edge Add-ons upload)`);
  console.log(`[package-extension] Description ${desc.length}/${EDGE_DESC_MAX} chars — OK for Edge`);
} finally {
  try {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
