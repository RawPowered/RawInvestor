/**
 * Decrypts packaged secure-runtime into userData for first run / version bump.
 * No license check — key is build-embedded obfuscation only.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function resolveSecureRuntimeRoot(app) {
  /** Prefer unpacked tree first (reliable on cloud drives and Windows layouts). */
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", "secure-runtime"),
    path.join(app.getAppPath(), "secure-runtime"),
    path.join(process.resourcesPath, "app", "secure-runtime"),
  ];
  for (const root of candidates) {
    try {
      if (root && fs.existsSync(path.join(root, "manifest.json"))) return root;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function decryptBuffer(key, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * ESM server resolves bare imports from ./node_modules — NODE_PATH is not enough.
 * Windows: directory junction to shipped tree. Other OS: symlink (dir).
 */
function ensureNodeModulesJunction(serverRoot, packagedNodeModules) {
  const dest = path.join(serverRoot, "node_modules");
  try {
    if (fs.existsSync(dest)) {
      const st = fs.lstatSync(dest);
      if (st.isSymbolicLink() || st.isDirectory()) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(packagedNodeModules, dest, linkType);
  } catch (err) {
    const winHint =
      "On Windows: install on the same drive as your user profile if possible, ensure your account may create directory links, or allow Raw Investor in antivirus. ";
    const msg = process.platform === "win32" ? winHint : "";
    throw new Error(
      `Could not link server dependencies (required for the local API). ${msg}Technical detail: ${err?.message || err}`
    );
  }
}

/** Create junction/symlink when decrypted server lacks resolvable node_modules (e.g. partial cache). */
function ensureDecryptedServerNodeModulesLinked(outRoot, packagedNm) {
  const serverRoot = path.join(outRoot, "server");
  if (!fs.existsSync(packagedNm)) {
    throw new Error(`Bundled server node_modules missing: ${packagedNm}`);
  }
  const expressProbe = path.join(serverRoot, "node_modules", "express");
  if (!fs.existsSync(expressProbe)) {
    ensureNodeModulesJunction(serverRoot, packagedNm);
  }
}

/**
 * @param {{ app: import('electron').App; emit?: (p: Record<string, unknown>) => void }} opts
 * @returns {string | null} decrypted tree root, or null if this build has no secure-runtime (legacy)
 */
function ensurePackagedRuntimeDecrypted(opts) {
  const { app, emit } = opts;
  if (!app.isPackaged) return null;

  const secureRoot = resolveSecureRuntimeRoot(app);
  if (!secureRoot) return null;

  const emitSafe = typeof emit === "function" ? emit : () => {};

  let getKey;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    getKey = require("./secure-key.cjs").getRuntimeKey;
  } catch (err) {
    throw new Error(
      `Missing generated rawengine/secure-key.cjs (run npm run prepare:encrypted-runtime before pack): ${err}`
    );
  }
  const key = getKey();

  const manifestPath = path.join(secureRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.v !== 1 || manifest.algorithm !== "aes-256-gcm" || !Array.isArray(manifest.entries)) {
    throw new Error("Invalid secure-runtime manifest.");
  }

  const version = app.getVersion();
  const outRoot = path.join(app.getPath("userData"), "runtime-data", "decrypted", version);
  const stampPath = path.join(outRoot, ".pcgr-runtime.stamp");
  const indexProbe = path.join(outRoot, "client", "dist", "index.html");
  const serverEntryProbe = path.join(outRoot, "server", "dist", "index.js");

  let skip = false;
  try {
    if (
      fs.existsSync(stampPath) &&
      fs.existsSync(indexProbe) &&
      fs.existsSync(serverEntryProbe)
    ) {
      const stamp = fs.readFileSync(stampPath, "utf8").trim();
      if (stamp === manifest.buildId) skip = true;
    }
  } catch {
    skip = false;
  }

  const packagedNm = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "server",
    "node_modules"
  );

  if (!skip) {
    emitSafe({
      label: "Preparing app files",
      detail: "One-time setup for this version…",
      steps: { check: "done", api: "active", connect: "" },
    });

    try {
      fs.rmSync(outRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    fs.mkdirSync(outRoot, { recursive: true });

    for (const ent of manifest.entries) {
      const encAbs = path.join(secureRoot, ent.encRel);
      const blob = fs.readFileSync(encAbs);
      const plain = decryptBuffer(key, blob);
      if (sha256(plain) !== ent.sha256) {
        throw new Error(`Integrity check failed for ${ent.rel}`);
      }
      const outAbs = path.join(outRoot, ent.rel);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, plain);
    }

    const pkgSrc = path.join(secureRoot, "server", "package.json");
    const pkgDest = path.join(outRoot, "server", "package.json");
    fs.mkdirSync(path.dirname(pkgDest), { recursive: true });
    fs.copyFileSync(pkgSrc, pkgDest);

    ensureDecryptedServerNodeModulesLinked(outRoot, packagedNm);

    fs.writeFileSync(stampPath, manifest.buildId, "utf8");
    console.log("[rawengine] decrypted runtime ->", outRoot);
  } else if (fs.existsSync(serverEntryProbe)) {
    ensureDecryptedServerNodeModulesLinked(outRoot, packagedNm);
  }

  return outRoot;
}

module.exports = { ensurePackagedRuntimeDecrypted, resolveSecureRuntimeRoot };
