import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import pngToIcoModule from "png-to-ico";

const pngToIco = pngToIcoModule.default || pngToIcoModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const brandTilePath = path.join(root, "brand", "RawInvestorTile300px.png");
const buildDir = path.join(root, "build");
const appxDir = path.join(buildDir, "appx");
const iconSizes = [16, 24, 32, 48, 64, 128, 256];
const TILE_BG = "#ed1c24";

/** @param {Buffer} source @param {number} size */
const squarePng = (source, size) =>
  sharp(source).resize(size, size, { fit: "cover", position: "centre" }).png();

/** Wide MSIX tile: red field + centered square logo. */
const wideTilePng = async (source, width, height) => {
  const logo = await squarePng(source, height).toBuffer();
  const left = Math.floor((width - height) / 2);
  return sharp({
    create: { width, height, channels: 4, background: TILE_BG },
  })
    .composite([{ input: logo, left, top: 0 }])
    .png()
    .toBuffer();
};

async function main() {
  if (!fs.existsSync(brandTilePath)) {
    throw new Error(`Missing brand tile: ${brandTilePath}`);
  }

  const source = await fs.promises.readFile(brandTilePath);
  await fs.promises.mkdir(appxDir, { recursive: true });

  const pngBuffers = [];
  for (const s of iconSizes) {
    const buf = await squarePng(source, s).toBuffer();
    pngBuffers.push(buf);
    await fs.promises.writeFile(path.join(buildDir, `icon-${s}.png`), buf);
  }

  const icon256 = pngBuffers[pngBuffers.length - 1];
  await fs.promises.writeFile(path.join(buildDir, "icon.png"), icon256);
  await fs.promises.writeFile(path.join(buildDir, "icon.ico"), await pngToIco(pngBuffers));

  const appxAssets = [
    ["StoreLogo.png", 50],
    ["Square44x44Logo.png", 44],
    ["Square150x150Logo.png", 150],
    ["SmallTile.png", 71],
    ["LargeTile.png", 310],
  ];
  for (const [name, size] of appxAssets) {
    const buf = await squarePng(source, size).toBuffer();
    await fs.promises.writeFile(path.join(appxDir, name), buf);
  }

  await fs.promises.writeFile(
    path.join(appxDir, "Wide310x150Logo.png"),
    await wideTilePng(source, 310, 150),
  );
  await fs.promises.writeFile(
    path.join(appxDir, "SplashScreen.png"),
    await wideTilePng(source, 620, 300),
  );

  console.log(`Wrote build/icon.* from ${path.relative(root, brandTilePath)}`);
  console.log(`Wrote build/appx/* MSIX tiles (background ${TILE_BG}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
