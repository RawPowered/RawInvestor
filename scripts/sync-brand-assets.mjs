import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pub = path.join(root, "client", "public");

async function main() {
  await fs.promises.mkdir(pub, { recursive: true });
  const pairs = [
    [path.join(root, "build", "icon.png"), path.join(pub, "icon.png")],
    [path.join(root, "build", "icon.ico"), path.join(pub, "favicon.ico")],
  ];
  for (const [src, dest] of pairs) {
    try {
      await fs.promises.access(src);
      await fs.promises.copyFile(src, dest);
    } catch {
      console.warn(`sync-brand-assets: skip missing ${src}`);
    }
  }
  console.log("Synced build/icon.* → client/public (favicon + icon.png).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
