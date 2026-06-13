/**
 * Release integrity gate — scan assurance repository before public push.
 * Usage: node scripts/publish-preflight.cjs [rootDir]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

const skipDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'rawengine/production',
  'secure-runtime',
  'Encrypted Release',
  'playwright-runtime',
  'release',
  'edge-extension-load',
]);

const skipDirPrefixes = ['.tmp-test-captures-'];

const forbiddenNamePatterns = [
  /^\.env$/i,
  /^\.env\.local$/i,
  /^\.env\.(?!example)/i,
  /secure-key\.cjs$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.pem$/i,
  /\.db$/i,
  /\.sqlite$/i,
  /\.sqlite3$/i,
  /credentials\.json$/i,
  /runtime-secrets\.json$/i,
  /portfolio-.*\.json$/i,
  /signing\.local\.json$/i,
  /msix-store\.identity\.json$/i,
];

const forbiddenContentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk_live_[0-9A-Za-z]{10,}/,
  /"ebayClientSecret"\s*:\s*"[^"]{8,}"/,
  /ebayClientSecret\s*=\s*['"][^'"]{8,}['"]/,
];

const textExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.md', '.html',
  '.css', '.xml', '.yml', '.yaml', '.env', '.example', '.bat', '.ps1', '.sql',
]);

const violations = [];

function shouldSkipDir(name) {
  if (skipDirs.has(name)) return true;
  return skipDirPrefixes.some((p) => name.startsWith(p));
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(full);
      continue;
    }
    for (const pat of forbiddenNamePatterns) {
      if (pat.test(entry.name)) {
        violations.push({ rel, reason: `forbidden filename: ${entry.name}` });
      }
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(ext) && ext !== '') continue;
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(entry.name)) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (rel.replace(/\\/g, '/').includes('scripts/publish-preflight.cjs')) continue;
    if (content.length > 2_000_000) continue;
    for (const pat of forbiddenContentPatterns) {
      if (pat.test(content)) {
        violations.push({ rel, reason: `forbidden content: ${pat}` });
        break;
      }
    }
  }
}

function checkExtensionConnection() {
  const connPath = path.join(root, 'extension', 'pcgr-connection.json');
  if (!fs.existsSync(connPath)) return;
  try {
    const doc = JSON.parse(fs.readFileSync(connPath, 'utf8'));
    for (const key of ['extToken', 'appToken']) {
      const val = String(doc[key] || '').trim();
      if (val) {
        violations.push({ rel: 'extension/pcgr-connection.json', reason: `${key} must be empty in assurance repo` });
      }
    }
  } catch {
    violations.push({ rel: 'extension/pcgr-connection.json', reason: 'invalid JSON' });
  }
}

walk(root);
checkExtensionConnection();

if (violations.length) {
  console.error('publish-preflight FAILED:\n');
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.rel} — ${v.reason}`);
  }
  if (violations.length > 50) {
    console.error(`  ... and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log('publish-preflight OK — no forbidden artifacts detected.');
process.exit(0);
