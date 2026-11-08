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
//  - EXIF orientation is applied, all original metadata (including GPS) is
//    stripped, and clean Artist/Copyright EXIF tags are written.
//  - Images are never upscaled; small originals just get fewer sizes.
//  - Unchanged photos are skipped unless --force is passed.
//  - Photos listed in the trip's "exclude" array (src/data/trips/<slug>.json)
//    are skipped, and outputs for removed/excluded photos are deleted.

import { spawnSync } from 'child_process';
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
const TRIPS_DIR = path.join(projectRoot, 'src', 'data', 'trips');
const OUT_DIR = path.join(projectRoot, 'public', 'photos');
const MANIFEST = path.join(projectRoot, 'src', 'data', 'photos.generated.json');

const WIDTHS = [640, 1280, 2048];
const QUALITY = 80;
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const force = process.argv.includes('--force');

/** File name -> the base name used everywhere else (outputs, manifest, trip JSON). */
const safeName = (file) => path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9._-]+/g, '-');

/** Base names listed in a trip's "exclude" array are never processed or published. */
function excludedFor(slug) {
  const tripFile = path.join(TRIPS_DIR, `${slug}.json`);
  if (!fs.existsSync(tripFile)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(tripFile, 'utf-8')).exclude ?? []);
  } catch (err) {
    console.error(`Could not read ${path.relative(projectRoot, tripFile)}: ${err.message}`);
    process.exit(1);
  }
}

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
let removed = 0;

for (const slug of slugs) {
  const tripSrc = path.join(SRC_DIR, slug);
  const tripOut = path.join(OUT_DIR, slug);
  fs.mkdirSync(tripOut, { recursive: true });

  const excluded = excludedFor(slug);
  const files = fs
    .readdirSync(tripSrc)
    .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
    .filter((f) => !excluded.has(safeName(f)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  manifest[slug] = [];
  const keep = new Set();

  for (const file of files) {
    const input = path.join(tripSrc, file);
    const name = safeName(file);

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
      keep.add(path.basename(output));
      const upToDate = fs.existsSync(output) && fs.statSync(output).mtimeMs >= inputMtime;
      if (upToDate && !force) {
        skipped++;
        continue;
      }
      await sharp(input)
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .withExif({ IFD0: { Artist: 'Jared Nussbaum', Copyright: '© Jared Nussbaum. All rights reserved.' } })
        .webp({ quality: QUALITY })
        .toFile(output);
      encoded++;
    }

    manifest[slug].push({ file: name, width, height, widths });
  }

  // Delete outputs for photos that were removed or excluded since the last run.
  for (const stale of fs.readdirSync(tripOut)) {
    if (stale.endsWith('.webp') && !keep.has(stale)) {
      fs.unlinkSync(path.join(tripOut, stale));
      removed++;
    }
  }

  console.log(`${slug}: ${files.length} photos${excluded.size ? ` (${excluded.size} excluded)` : ''}`);
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Done. ${encoded} encoded, ${skipped} up to date, ${removed} stale removed. Manifest: ${path.relative(projectRoot, MANIFEST)}`);

// Apply TrustMark invisible pixel watermark ("jaredn.dev") + C2PA ES256 signature.
const venvPythonWin = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
const venvPythonPosix = path.join(projectRoot, '.venv', 'bin', 'python');
const venvPython = fs.existsSync(venvPythonWin) ? venvPythonWin : fs.existsSync(venvPythonPosix) ? venvPythonPosix : null;
const signScript = path.join(__dirname, 'sign_and_watermark.py');
if (venvPython && fs.existsSync(signScript)) {
  const res = spawnSync(venvPython, [signScript, ...(force ? ['--force'] : [])], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

// Optionally sync to Cloudflare R2 bucket if --sync is passed
const syncScript = path.join(__dirname, 'sync_r2.py');
if (venvPython && fs.existsSync(syncScript) && process.argv.includes('--sync')) {
  const syncRes = spawnSync(venvPython, [syncScript], { stdio: 'inherit' });
  if (syncRes.status !== 0) console.warn('Warning: R2 sync failed (network unreachable). Run pnpm sync:photos to retry.');
}
