/**
 * Remove rawengine/production before electron-builder so a failed or partial
 * win-unpacked (e.g. electron.exe without RawInvestor.exe) cannot break the next pack.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = path.resolve(__dirname, "..", "rawengine", "production");

function main() {
  if (!fs.existsSync(production)) {
    console.log("[clean-electron-production] nothing to remove.");
    return;
  }
  fs.rmSync(production, { recursive: true, force: true });
  console.log("[clean-electron-production] removed rawengine/production.");
}

main();
