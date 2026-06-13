import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skinsSrc = path.join(root, "Skins");
const skinsDest = path.join(root, "client", "public", "skins");

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(from, to);
    } else if (ent.isFile()) {
      await fs.promises.copyFile(from, to);
    }
  }
}

async function main() {
  try {
    await fs.promises.access(skinsSrc);
  } catch {
    console.warn("sync-streamer-skins: Skins/ not found — skip.");
    return;
  }
  const ids = await fs.promises.readdir(skinsSrc, { withFileTypes: true });
  let copied = 0;
  for (const ent of ids) {
    if (!ent.isDirectory()) continue;
    const from = path.join(skinsSrc, ent.name);
    const to = path.join(skinsDest, ent.name);
    await copyDir(from, to);
    copied += 1;
  }
  console.log(`Synced ${copied} streamer skin(s) from Skins/ → client/public/skins/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
