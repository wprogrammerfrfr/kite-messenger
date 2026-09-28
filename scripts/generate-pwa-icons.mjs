// Renders public/kite-mobile-icon.svg into the PNG set the PWA manifest, iOS and notifications need.
// Run: npm run icons
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const svgPath = path.join(root, "public", "kite-mobile-icon.svg");
const outDir = path.join(root, "public", "icons");
const SVG_VIEWBOX = 64;
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const svg = await readFile(svgPath);
await mkdir(outDir, { recursive: true });

/** Rasterize the logo at `logoSize` px (density-scaled so edges stay crisp). */
async function renderLogo(logoSize) {
  const density = Math.ceil((72 * logoSize) / SVG_VIEWBOX);
  return sharp(svg, { density })
    .resize(logoSize, logoSize, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
}

/** Logo centered on a square canvas; `scale` = logo size as a fraction of the canvas. */
async function writeIcon(filename, size, { scale = 1, background = TRANSPARENT } = {}) {
  const logoSize = Math.round(size * scale);
  const logo = await renderLogo(logoSize);
  const offset = Math.round((size - logoSize) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, left: offset, top: offset }])
    .png()
    .toFile(path.join(outDir, filename));
  console.log(`  ${filename} (${size}x${size})`);
}

/**
 * Android draws notification badges from alpha only, so emit a white silhouette with the
 * white track lines knocked out to keep the logo readable at 24dp.
 */
async function writeBadge(filename, size) {
  const logo = await renderLogo(size);
  const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const isTrackLine = data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    if (isTrackLine) data[i + 3] = 0;
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(path.join(outDir, filename));
  console.log(`  ${filename} (${size}x${size}, monochrome)`);
}

console.log("Generating PWA icons from kite-mobile-icon.svg:");
await writeIcon("icon-192.png", 192);
await writeIcon("icon-512.png", 512);
// Maskable: Android crops to the inner 80% circle; diamond tips stay inside at 72%.
await writeIcon("maskable-512.png", 512, { scale: 0.72, background: BLACK });
await writeIcon("apple-touch-icon-180.png", 180, { scale: 0.8, background: BLACK });
await writeIcon("favicon-32.png", 32);
await writeBadge("badge-96.png", 96);
console.log("Done.");
