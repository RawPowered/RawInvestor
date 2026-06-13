import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseRoot = path.join(root, "rawengine", "production");

const forbiddenNamePatterns = [
  /\.env(\.|$)/i,
  /id_rsa/i,
  /id_dsa/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /credentials\.json$/i,
  /service-account/i,
  /secret/i,
  /private[_-]?key/i,
];

const forbiddenContentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /sk_live_[0-9A-Za-z]{10,}/,
  /sk_(?:test|live)_[0-9A-Za-z]{16,}/,
  /PKCS12|PFX/i,
  /-----BEGIN CERTIFICATE-----/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}/,
  /(?:token|secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

const textLikeExtensions = new Set([
  ".txt",
  ".json",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".yml",
  ".yaml",
  ".md",
  ".xml",
  ".ini",
  ".cfg",
  ".conf",
  ".html",
  ".css",
  ".env",
  ".log",
]);

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    out.push(abs);
  }
}

function isIgnoredPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const scanMd = String(process.env.PCGR_RELEASE_SCAN_MD || "").trim() === "1";
  return (
    normalized.includes("/node_modules/") ||
    /\.test\.[cm]?[jt]sx?$/i.test(normalized) ||
    normalized.endsWith(".map") ||
    (!scanMd && normalized.endsWith(".md"))
  );
}

function isLikelyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textLikeExtensions.has(ext)) return true;
  const size = fs.statSync(filePath).size;
  if (size > 1024 * 1024 * 2) return false;
  return false;
}

if (!fs.existsSync(releaseRoot)) {
  console.error(`[release-check] Missing folder: ${releaseRoot}`);
  console.error(
    "[release-check] Run a build first, e.g. npm run beta:build or npm run beta:build:signed."
  );
  process.exit(1);
}

const files = [];
walk(releaseRoot, files);

const findings = [];
for (const filePath of files) {
  if (isIgnoredPath(filePath)) continue;
  const rel = path.relative(root, filePath).replaceAll("\\", "/");
  for (const pattern of forbiddenNamePatterns) {
    if (pattern.test(path.basename(filePath))) {
      findings.push(`[name] ${rel} matches ${pattern}`);
      break;
    }
  }

  if (!isLikelyText(filePath)) continue;

  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  for (const pattern of forbiddenContentPatterns) {
    if (pattern.test(content)) {
      findings.push(`[content] ${rel} matches ${pattern}`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("[release-check] Potential secrets found in release artifacts:");
  for (const finding of findings) {
    console.error(` - ${finding}`);
  }
  process.exit(2);
}

console.log(
  `[release-check] OK: scanned ${files.length} files in ${path.relative(
    root,
    releaseRoot
  )}`
);
