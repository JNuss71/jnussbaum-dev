// Builds web-ready photos from originals.
//
//   photos-src/<trip-slug>/<name>.jpg   (originals, git-ignored)
//        |
//        v
//   public/photos/<trip-slug>/<name>-<width>.webp   (responsive sizes)
//   src/data/photos.generated.json                  (file list + dimensions)
//
// Usage:  pnpm build:photos [--force]
//
// Notes:
//  - EXIF orientation is applied, then all metadata (including GPS) is stripped.
//  - Images are never upscaled; small originals just get fewer sizes.
//  - Unchanged photos are skipped unless --force is passed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('This script needs sharp. Install it once with:  pnpm add -D sharp');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SRC_DIR = path.join(projectRoot, 'photos-src');
const OUT_DIR = path.join(projectRoot, 'public', 'photos');
const MANIFEST = path.join(projectRoot, 'src', 'data', 'photos.generated.json');

const WIDTHS = [640, 1280, 2048];
const QUALITY = 80;
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const force = process.argv.includes('--force');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`No originals found. Put photos in ${SRC_DIR}/<trip-slug>/ and re-run.`);
  process.exit(1);
}

const slugs = fs
  .readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const manifest = {};
let encoded = 0;
let skipped = 0;

for (const slug of slugs) {
  const tripSrc = path.join(SRC_DIR, slug);
  const tripOut = path.join(OUT_DIR, slug);
  fs.mkdirSync(tripOut, { recursive: true });

  const files = fs
    .readdirSync(tripSrc)
    .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  manifest[slug] = [];

  for (const file of files) {
    const input = path.join(tripSrc, file);
    const name = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9._-]+/g, '-');

    // Dimensions as displayed (after EXIF rotation).
    const meta = await sharp(input).metadata();
    const swap = meta.orientation && meta.orientation >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;

    const widths = WIDTHS.filter((w) => w < width);
    if (width <= WIDTHS[WIDTHS.length - 1]) widths.push(width);

    const inputMtime = fs.statSync(input).mtimeMs;

    for (const w of widths) {
      const output = path.join(tripOut, `${name}-${w}.webp`);
      const upToDate = fs.existsSync(output) && fs.statSync(output).mtimeMs >= inputMtime;
      if (upToDate && !force) {
        skipped++;
        continue;
      }
      await sharp(input)
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(output);
      encoded++;
    }

    manifest[slug].push({ file: name, width, height, widths });
  }

  console.log(`${slug}: ${files.length} photos`);
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Done. ${encoded} encoded, ${skipped} up to date. Manifest: ${path.relative(projectRoot, MANIFEST)}`);
