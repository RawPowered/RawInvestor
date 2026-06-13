import fs from "node:fs";
import path from "node:path";

/**
 * Ensure manifest.json declares only files that exist in the extension folder.
 */
export function validateManifestResources(extDir, manifest) {
  const missing = [];
  const war = manifest.web_accessible_resources;
  if (Array.isArray(war)) {
    for (const block of war) {
      const resources = block?.resources;
      if (!Array.isArray(resources)) continue;
      for (const rel of resources) {
        const abs = path.join(extDir, String(rel).replace(/\//g, path.sep));
        if (!fs.existsSync(abs)) missing.push(String(rel));
      }
    }
  }
  const popup = manifest?.action?.default_popup;
  if (popup && !fs.existsSync(path.join(extDir, popup))) missing.push(popup);
  const sw = manifest?.background?.service_worker;
  if (sw && !fs.existsSync(path.join(extDir, sw))) missing.push(sw);
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      for (const js of cs.js || []) {
        if (!fs.existsSync(path.join(extDir, js))) missing.push(js);
      }
    }
  }
  return missing;
}

export function assertManifestResources(extDir, manifest, label) {
  const missing = validateManifestResources(extDir, manifest);
  if (missing.length) {
    console.error(`[${label}] Manifest references missing files:`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
}
