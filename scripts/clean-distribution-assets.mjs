/**
 * Remove scraped card images (and any other junk) under server/images so packaged
 * testers/builds do not ship dev-local cache. Keeps .gitkeep only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(__dirname, "..", "server", "images");

if (!fs.existsSync(imagesDir)) {
  console.warn("[clean-distribution-assets] server/images missing — skip.");
  process.exit(0);
}

let removed = 0;
for (const ent of fs.readdirSync(imagesDir, { withFileTypes: true })) {
  if (ent.name === ".gitkeep") continue;
  const p = path.join(imagesDir, ent.name);
  fs.rmSync(p, { recursive: true, force: true });
  removed += 1;
}
console.log(
  `[clean-distribution-assets] server/images: removed ${removed} entr${removed === 1 ? "y" : "ies"} (kept .gitkeep).`
);
