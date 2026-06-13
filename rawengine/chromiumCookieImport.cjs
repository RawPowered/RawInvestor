/**
 * Import HTTP cookies from local Chromium profiles (Edge / Chrome) into an Electron session.
 * Windows only. Uses better-sqlite3 from the unpacked server bundle.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
  MARKER_FILENAME,
  cookieHostAllowedForImport,
  chromeExpirationToUnixSeconds,
  hostKeyToCookieUrl,
} = require("./chromiumCookieImportHelpers.cjs");

/**
 * @returns {string}
 */
function resolveBetterSqlite3Root() {
  const resources = process.resourcesPath || "";
  const unpacked = path.join(resources, "app.asar.unpacked", "server", "node_modules", "better-sqlite3");
  if (resources && fs.existsSync(path.join(unpacked, "package.json"))) return unpacked;
  const dev = path.join(__dirname, "..", "server", "node_modules", "better-sqlite3");
  if (fs.existsSync(path.join(dev, "package.json"))) return dev;
  throw new Error("better-sqlite3 not found (expected under app.asar.unpacked/server/node_modules)");
}

/**
 * @param {Buffer} ciphertext
 * @returns {Buffer}
 */
function dpapiUnprotect(ciphertext) {
  const b64 = ciphertext.toString("base64");
  const ps = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -AssemblyName System.Security;" +
      `$b=[Convert]::FromBase64String('${b64}');` +
      "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
      "[Convert]::ToBase64String($p)",
  ];
  const out = execFileSync("powershell.exe", ps, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  }).trim();
  return Buffer.from(out, "base64");
}

/**
 * @param {string} profileDir Default profile folder (…/User Data/Default)
 * @returns {Buffer}
 */
function readChromiumMasterKey(profileDir) {
  const localStatePath = path.join(profileDir, "..", "Local State");
  const raw = fs.readFileSync(localStatePath, "utf8");
  const j = JSON.parse(raw);
  const enc = j?.os_crypt?.encrypted_key;
  if (typeof enc !== "string" || !enc) throw new Error("Local State missing os_crypt.encrypted_key");
  const buf = Buffer.from(enc, "base64");
  if (buf.length < 6) throw new Error("encrypted_key too short");
  const prefix = buf.slice(0, 5).toString("utf8");
  if (prefix !== "DPAPI") throw new Error(`unexpected encrypted_key prefix: ${prefix}`);
  return dpapiUnprotect(buf.slice(5));
}

/**
 * @param {Buffer} encVal
 * @param {Buffer} masterKey
 * @returns {string | null}
 */
function decryptChromiumCookie(encVal, masterKey) {
  if (!encVal || encVal.length === 0) return null;
  if (encVal[0] !== 0x76) return null;
  const ver = encVal.slice(0, 3).toString("utf8");
  if (ver !== "v10" && ver !== "v11") return null;
  const iv = encVal.slice(3, 15);
  const ciphertext = encVal.slice(15, encVal.length - 16);
  const tag = encVal.slice(encVal.length - 16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * @param {string} profileDir
 * @returns {string | null}
 */
function resolveCookieDbPath(profileDir) {
  const network = path.join(profileDir, "Network", "Cookies");
  if (fs.existsSync(network)) return network;
  const legacy = path.join(profileDir, "Cookies");
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

/**
 * @param {string} cookieDbPath
 * @returns {any}
 */
/**
 * @param {string} cookieDbPath
 * @returns {{ db: any; tmpPath: string }}
 */
function openCookieDbCopy(cookieDbPath) {
  const root = resolveBetterSqlite3Root();
  const Database = require(path.join(root, "lib", "index.js"));
  const tmpPath = path.join(os.tmpdir(), `pcgr-chromium-cookies-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(cookieDbPath, tmpPath);
  const db = new Database(tmpPath, { readonly: true });
  return { db, tmpPath };
}

/**
 * @param {import('electron').Session} electronSession
 * @param {{ edge?: boolean; chrome?: boolean }} opts
 * @returns {Promise<{ ok: boolean; imported: number; skipped: number; errors: number; details: string[] }>}
 */
async function importChromiumCookiesIntoSession(electronSession, opts) {
  const details = [];
  if (process.platform !== "win32") {
    return { ok: false, imported: 0, skipped: 0, errors: 1, details: ["Cookie import is only supported on Windows."] };
  }
  const edge = opts?.edge === true;
  const chrome = opts?.chrome === true;
  if (!edge && !chrome) {
    return { ok: false, imported: 0, skipped: 0, errors: 0, details: ["No sources selected."] };
  }

  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) {
    return { ok: false, imported: 0, skipped: 0, errors: 1, details: ["LOCALAPPDATA is not set."] };
  }

  const profiles = [];
  if (edge) profiles.push({ name: "Edge", dir: path.join(localAppData, "Microsoft", "Edge", "User Data", "Default") });
  if (chrome) profiles.push({ name: "Chrome", dir: path.join(localAppData, "Google", "Chrome", "User Data", "Default") });

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const { name, dir } of profiles) {
    if (!fs.existsSync(dir)) {
      details.push(`${name}: profile folder not found (${dir})`);
      errors += 1;
      continue;
    }
    let masterKey;
    try {
      masterKey = readChromiumMasterKey(dir);
    } catch (e) {
      details.push(`${name}: could not read master key — ${String(e?.message || e)}`);
      errors += 1;
      continue;
    }
    const cookiePath = resolveCookieDbPath(dir);
    if (!cookiePath) {
      details.push(`${name}: no Cookies database`);
      errors += 1;
      continue;
    }
    let db;
    let tmpDbPath = null;
    try {
      const opened = openCookieDbCopy(cookiePath);
      db = opened.db;
      tmpDbPath = opened.tmpPath;
    } catch (e) {
      details.push(`${name}: could not open cookie DB (close ${name} and try again) — ${String(e?.message || e)}`);
      errors += 1;
      continue;
    }
    try {
      const rows = db
        .prepare(
          `SELECT host_key, name, path, encrypted_value, value, expires_utc, is_secure, is_httponly, samesite
           FROM cookies`
        )
        .all();
      for (const row of rows) {
        const hostKey = String(row.host_key || "");
        if (!cookieHostAllowedForImport(hostKey)) {
          skipped += 1;
          continue;
        }
        const encBuf = row.encrypted_value;
        let plain = null;
        if (Buffer.isBuffer(encBuf) && encBuf.length > 0) {
          plain = decryptChromiumCookie(encBuf, masterKey);
        }
        if (plain == null && typeof row.value === "string" && row.value.length > 0) {
          plain = row.value;
        }
        if (plain == null || plain === "") {
          skipped += 1;
          continue;
        }
        const url = hostKeyToCookieUrl(hostKey);
        const expSec = chromeExpirationToUnixSeconds(Number(row.expires_utc));
        /** @type {Record<string, unknown>} */
        const detailsIn = {
          url,
          name: String(row.name || ""),
          value: plain,
          path: String(row.path || "/"),
          secure: Number(row.is_secure) === 1,
          httpOnly: Number(row.is_httponly) === 1,
        };
        if (expSec != null) detailsIn.expirationDate = expSec;
        const ss = Number(row.samesite);
        if (ss === 1) detailsIn.sameSite = "lax";
        else if (ss === 2) detailsIn.sameSite = "strict";
        else if (ss === 0 || ss === 3) detailsIn.sameSite = "no_restriction";
        try {
          await electronSession.cookies.set(/** @type {any} */ (detailsIn));
          imported += 1;
        } catch {
          skipped += 1;
        }
      }
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      if (tmpDbPath) {
        try {
          fs.unlinkSync(tmpDbPath);
        } catch {
          /* ignore */
        }
      }
    }
    details.push(`${name}: processed cookies`);
  }

  return {
    ok: errors === 0 || imported > 0,
    imported,
    skipped,
    errors,
    details,
  };
}

/**
 * @param {string} resourcesPath
 * @returns {string}
 */
function getPendingMarkerPath(resourcesPath) {
  return path.join(String(resourcesPath || ""), MARKER_FILENAME);
}

/**
 * @param {string} resourcesPath
 * @returns {{ edge: boolean; chrome: boolean } | null}
 */
function readPendingMarker(resourcesPath) {
  const p = getPendingMarkerPath(resourcesPath);
  try {
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      edge: j?.edge === true,
      chrome: j?.chrome === true,
    };
  } catch {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * @param {string} resourcesPath
 */
function deletePendingMarker(resourcesPath) {
  const p = getPendingMarkerPath(resourcesPath);
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

module.exports = {
  MARKER_FILENAME,
  importChromiumCookiesIntoSession,
  getPendingMarkerPath,
  readPendingMarker,
  deletePendingMarker,
  resolveBetterSqlite3Root,
};
