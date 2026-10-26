// Renders the FIKA app icons (bolt mark on black) to PNG with sharp. Run: npm run icons
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BOLT =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

function svg(size, { radius, inset }) {
  const scale = (size * (1 - inset * 2)) / 24;
  const offset = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#000"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${BOLT}" fill="#fff"/></g>
</svg>`;
}

const out = path.resolve("public/icons");
fs.mkdirSync(out, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, radius: 40, inset: 0.22 },
  { file: "icon-512.png", size: 512, radius: 108, inset: 0.22 },
  // Maskable icons need the mark inside the central safe zone and a full-bleed background.
  { file: "icon-maskable-512.png", size: 512, radius: 0, inset: 0.3 },
  { file: "apple-touch-icon.png", size: 180, radius: 0, inset: 0.24 },
];

for (const t of targets) {
  await sharp(Buffer.from(svg(t.size, t))).png().toFile(path.join(out, t.file));
  console.log("wrote", t.file);
}
fs.writeFileSync(path.resolve("app/icon.svg"), svg(64, { radius: 14, inset: 0.2 }));
console.log("wrote app/icon.svg");
