// First-pass curation for a trip: stage -> filter -> group -> (optional) AI captions.
//
//   photos-src/<slug>/*.jpg            originals (git-ignored)
//        |
//        v
//   photos-src/<slug>/curation.json    full per-photo report (git-ignored)
//   src/data/trips/<slug>.json         DRAFT trip file for you to edit
//
// Usage:
//   pnpm curate:photos <slug>                  local checks only, no network
//   pnpm curate:photos <slug> --ai             add captions, alt text and day titles
//   pnpm curate:photos <slug> --rewrite        regenerate the trip file (old one is backed up)
//   pnpm curate:photos <slug> --ai --model <id>
//
// What it does without --ai (all local):
//   - reads the capture time from EXIF and groups photos into days
//   - flags near-duplicates (keeps the sharpest) and very soft shots
// What --ai adds (Gemini; needs GEMINI_API_KEY in your environment):
//   - alt text, a short caption, and a quality rating per kept photo
//   - a suggested title for each day
//
// Privacy: only resized 1024px copies are sent, with ALL metadata (GPS included)
// stripped. Nothing is sent without --ai. Originals are never modified.
// Everything it writes is a suggestion: the draft has "draft": true so it stays
// out of production builds until you remove that line.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_MODEL,
  GENRES,
  ISSUES,
  SCORE_SCHEMA,
  SCORE_SYSTEM,
  STRENGTHS,
  TITLE_SCHEMA,
  TITLE_SYSTEM,
  gemini,
  usageSummary,
} from './lib/photo_critique.js';

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

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--model' && args[i - 1] !== '--limit');

if (!slug) {
  console.error('Usage: pnpm curate:photos <trip-slug> [--ai] [--rewrite] [--model <id>]');
  process.exit(1);
}

const useAi = flag('--ai');
const rewrite = flag('--rewrite');
const MODEL = option('--model') ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
const LIMIT = Number(option('--limit')) || Infinity; // score only the first N photos (for trying a prompt)
const API_KEY = process.env.GEMINI_API_KEY;

if (useAi && !API_KEY) {
  console.error('--ai needs a Gemini API key. Set it in your shell first:  export GEMINI_API_KEY=...');
  process.exit(1);
}

const tripSrc = path.join(SRC_DIR, slug);
if (!fs.existsSync(tripSrc)) {
  console.error(`No folder at ${tripSrc}. Put the originals in photos-src/${slug}/ first.`);
  process.exit(1);
}

// ---------------------------------------------------------------- constants

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ANALYSIS_WIDTH = 512;
const AI_WIDTH = 1024;
const DUP_WINDOW_MS = 90 * 1000; // shots this close together can be duplicates
const DUP_MAX_DISTANCE = 8; // out of 64 bits of difference hash
const SOFT_RATIO = 0.25; // sharpness below this fraction of the trip median = very soft
const CONCURRENCY = 8; // local sharp worker pool
const AI_CONCURRENCY = 96; // Gemini requests in flight (~400 RPM, ~1.1M TPM on Argon)
const PROMPT_VERSION = 3; // bump to invalidate cached AI results

const safeName = (file) => path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9._-]+/g, '-');
const pad = (n) => String(n).padStart(2, '0');

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------- EXIF time

/** Minimal EXIF reader: capture time only. Returns {y,mo,d,h,mi,s} (camera local time) or null. */
function exifDateTime(buf) {
  if (!buf) return null;
  try {
    const start = buf.toString('latin1', 0, 6) === 'Exif\0\0' ? 6 : 0;
    const tiff = buf.subarray(start);
    const mark = tiff.toString('latin1', 0, 2);
    if (mark !== 'II' && mark !== 'MM') return null;
    const le = mark === 'II';
    const u16 = (p) => (le ? tiff.readUInt16LE(p) : tiff.readUInt16BE(p));
    const u32 = (p) => (le ? tiff.readUInt32LE(p) : tiff.readUInt32BE(p));
    const readIfd = (off) => {
      const entries = new Map();
      if (off + 2 > tiff.length) return entries;
      const n = u16(off);
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        if (e + 12 > tiff.length) break;
        entries.set(u16(e), { count: u32(e + 4), pos: e + 8 });
      }
      return entries;
    };
    const ascii = (ent) => {
      const p = ent.count > 4 ? u32(ent.pos) : ent.pos;
      return tiff.toString('latin1', p, p + ent.count - 1);
    };

    const ifd0 = readIfd(u32(4));
    let text;
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const sub = readIfd(u32(exifPtr.pos));
      const ent = sub.get(0x9003) ?? sub.get(0x9004); // DateTimeOriginal, then DateTimeDigitized
      if (ent) text = ascii(ent);
    }
    if (!text && ifd0.get(0x0132)) text = ascii(ifd0.get(0x0132)); // DateTime

    const m = text?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const t = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
    return t.y >= 1990 && t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 ? t : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- local analysis

const popcount = (n) => {
  let c = 0;
  while (n) {
    c += Number(n & 1n);
    n >>= 1n;
  }
  return c;
};

const meanOf = (buf) => {
  let sum = 0;
  for (const v of buf) sum += v;
  return sum / buf.length;
};

const stdevOf = (buf) => {
  const mean = meanOf(buf);
  let sq = 0;
  for (const v of buf) sq += (v - mean) ** 2;
  return Math.sqrt(sq / buf.length);
};

/** Sets the fields that depend on the capture time. `t` is camera-local time, no timezone. */
function setTime(p, t, source) {
  p.ts = Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s);
  p.day = `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
  p.time = `${p.day}T${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}`;
  p.timeSource = source;
}

async function analyze(file) {
  const input = path.join(tripSrc, file);
  const stat = fs.statSync(input);
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const swap = meta.orientation && meta.orientation >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;

  const exifT = exifDateTime(meta.exif);
  const m = new Date(stat.mtimeMs);
  const mtimeT = { y: m.getFullYear(), mo: m.getMonth() + 1, d: m.getDate(), h: m.getHours(), mi: m.getMinutes(), s: m.getSeconds() };

  const small = () => sharp(input, { failOn: 'none' }).rotate().resize({ width: ANALYSIS_WIDTH }).greyscale();

  // NB: sharp's stats() ignores pipeline operations, so measure the processed pixels directly.
  const gray = await small().raw().toBuffer();
  const brightness = meanOf(gray);
  // Sharpness: spread of the Laplacian response. Only meaningful relative to the
  // rest of the trip, so it is compared against the median later.
  const lap = await small()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  const sharpness = stdevOf(lap);

  // 64-bit difference hash for near-duplicate detection.
  const px = await sharp(input, { failOn: 'none' }).rotate().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }

  return {
    file,
    name: safeName(file),
    width,
    height,
    exifT,
    mtimeT,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sharpness: Math.round(sharpness * 100) / 100,
    brightness: Math.round(brightness),
    hash,
  };
}

// ----------------------------------------------------------------- Gemini
// Rubric, schemas and the API client live in lib/photo_critique.js (shared with rank_photos.js).

const cleanStr = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const clampGrade = (v) => (Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : undefined);

async function describePhoto(photo) {
  const jpeg = await sharp(path.join(tripSrc, photo.file), { failOn: 'none' })
    .rotate()
    .resize({ width: AI_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85 }) // sharp drops all metadata (EXIF, GPS) unless asked to keep it
    .toBuffer();
  const out = await gemini({
    model: MODEL,
    apiKey: API_KEY,
    system: SCORE_SYSTEM,
    schema: SCORE_SCHEMA,
    parts: [
      { text: 'Critique this photograph.' },
      { inline_data: { mime_type: 'image/jpeg', data: jpeg.toString('base64') } },
    ],
  });
  if (!out) return null;
  const result = {
    genre: GENRES.includes(out.genre) ? out.genre : undefined,
    critique: cleanStr(out.critique, 800),
    scores: {
      intent: clampGrade(out.intent),
      composition: clampGrade(out.composition),
      light: clampGrade(out.light),
      moment: clampGrade(out.moment),
      craft: clampGrade(out.craft),
    },
    quality: clampGrade(out.quality),
    issues: Array.isArray(out.issues) ? out.issues.filter((i) => ISSUES.includes(i)) : [],
    strengths: Array.isArray(out.strengths) ? out.strengths.filter((x) => STRENGTHS.includes(x)) : [],
    caption: cleanStr(out.caption, 100),
    alt: cleanStr(out.alt, 160),
  };
  return result.quality && (result.alt || result.caption) ? result : null;
}

async function suggestDayTitle(captions) {
  const out = await gemini({
    model: MODEL,
    apiKey: API_KEY,
    system: TITLE_SYSTEM,
    schema: TITLE_SCHEMA,
    parts: [{ text: `Captions of photos from one day of a trip:\n- ${captions.join('\n- ')}\n\nSuggest a title for the day.` }],
  });
  return cleanStr(out?.title, 60);
}

// ------------------------------------------------------------------- main

const files = fs
  .readdirSync(tripSrc)
  .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length === 0) {
  console.error(`No photos found in ${tripSrc}.`);
  process.exit(1);
}

const seen = new Map();
for (const f of files) {
  const n = safeName(f);
  if (seen.has(n)) {
    console.error(`"${seen.get(n)}" and "${f}" would both be published as "${n}". Rename one of them.`);
    process.exit(1);
  }
  seen.set(n, f);
}

console.log(`Analyzing ${files.length} photos in photos-src/${slug}/ ...`);
const photos = await pool(files, CONCURRENCY, analyze);

// Capture times. Photos without EXIF time (screenshots, exports) are slotted in next to
// the previous photo by file name, since cameras number files in order. If NO photo has
// EXIF time, fall back to file modified times for everything.
if (photos.some((p) => p.exifT)) {
  let carry = null;
  photos.forEach((p, i) => {
    if (p.exifT) {
      setTime(p, p.exifT, 'exif');
      carry = p.exifT;
    } else {
      const donor = carry ?? photos.slice(i + 1).find((q) => q.exifT).exifT;
      setTime(p, donor, 'placed-by-file-name');
    }
  });
} else {
  for (const p of photos) setTime(p, p.mtimeT, 'file-modified-time');
}
for (const p of photos) {
  delete p.exifT;
  delete p.mtimeT;
}

photos.sort((a, b) => a.ts - b.ts || a.file.localeCompare(b.file, undefined, { numeric: true }));

// -- suggested drops: near-duplicates, then very soft shots
const sorted = [...photos.map((p) => p.sharpness)].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];

let cluster = [];
const clusters = [];
for (const p of photos) {
  const prev = cluster[cluster.length - 1];
  if (prev && p.ts - prev.ts <= DUP_WINDOW_MS && popcount(p.hash ^ prev.hash) <= DUP_MAX_DISTANCE) {
    cluster.push(p);
  } else {
    if (cluster.length > 1) clusters.push(cluster);
    cluster = [p];
  }
}
if (cluster.length > 1) clusters.push(cluster);

// Only use non-AI pixel heuristics when running without --ai; with --ai every photo is
// scored by the model and deduplication happens visually after ranking.
if (!useAi) {
  for (const group of clusters) {
    const best = group.reduce((a, b) => (b.sharpness > a.sharpness ? b : a));
    for (const p of group) if (p !== best) p.drop = `near-duplicate of ${best.name}`;
  }
  for (const p of photos) {
    if (!p.drop && median > 0 && p.sharpness < median * SOFT_RATIO) p.drop = 'very soft compared with the rest of the trip';
  }
}

let kept = photos.filter((p) => !p.drop);
const aiTargets = Number.isFinite(LIMIT) ? kept.slice(0, LIMIT) : kept;

// -- optional AI pass (kept photos only, cached on disk)
const cachePath = path.join(tripSrc, '.curation-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf-8')) : {};
const dayTitles = {};

if (useAi) {
  console.log(`Asking ${MODEL} about ${aiTargets.length} photos (cached results are reused) ...`);
  const keyOf = (p) => `${p.file}|${p.size}|${p.mtimeMs}|${MODEL}|v${PROMPT_VERSION}`;
  let failed = 0;
  let done = 0;
  try {
    await pool(aiTargets, AI_CONCURRENCY, async (p) => {
      const key = keyOf(p);
      if (cache[key]) {
        p.ai = cache[key];
        done++;
        return;
      }
      try {
        p.ai = await describePhoto(p);
        if (p.ai) cache[key] = p.ai;
        else failed++;
      } catch (err) {
        if (err.fatal) throw err;
        failed++;
      }
      done++;
      if (done % 50 === 0 || done === aiTargets.length) {
        fs.writeFileSync(cachePath, JSON.stringify(cache));
        console.log(`  scored ${done} / ${aiTargets.length}`);
      }
    });

    const byDay = Map.groupBy(kept, (p) => p.day);
    await pool([...byDay], CONCURRENCY, async ([day, list]) => {
      const captions = list.map((p) => p.ai?.caption).filter(Boolean).slice(0, 25);
      if (captions.length === 0) return;
      const key = `day|${day}|${captions.join('|')}|${MODEL}|v${PROMPT_VERSION}`;
      if (cache[key]) {
        dayTitles[day] = cache[key];
        return;
      }
      try {
        const title = await suggestDayTitle(captions);
        if (title) dayTitles[day] = cache[key] = title;
      } catch (err) {
        if (err.fatal) throw err;
      }
    });
  } catch (err) {
    console.error(`\n${err.message}`);
    console.error('Stopping the AI pass. Results so far are cached, so re-running will pick up where this left off.');
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    process.exit(1);
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  if (failed) console.log(`  ${failed} photos got no usable AI answer (left without captions).`);
}

// -- group the kept photos into days
const days = [...Map.groupBy(kept, (p) => p.day)].sort(([a], [b]) => a.localeCompare(b));
const dayNumber = (day) => Math.round((Date.parse(day) - Date.parse(days[0][0])) / 86400000) + 1;
const dayLabel = (day) => {
  const [, m, d] = day.split('-').map(Number);
  return `Day ${dayNumber(day)} · ${MONTHS[m - 1]} ${d}`;
};

const first = photos[0];
const last = photos[photos.length - 1];
const [fy, fm] = first.day.split('-').map(Number);
const [ly, lm] = last.day.split('-').map(Number);
const dateText =
  fy === ly && fm === lm
    ? `${MONTHS[fm - 1]} ${fy}`
    : fy === ly
      ? `${MONTHS[fm - 1]} – ${MONTHS[lm - 1]} ${fy}`
      : `${MONTHS[fm - 1]} ${fy} – ${MONTHS[lm - 1]} ${ly}`;

// -- best candidate for the cover: highest AI rating, then criterion grades, then sharpest
const criterionSum = (p) => Object.values(p.ai?.scores ?? {}).reduce((a, b) => a + (b ?? 0), 0);
const cover = [...kept].sort(
  (a, b) =>
    (b.ai?.quality ?? 0) - (a.ai?.quality ?? 0) ||
    criterionSum(b) - criterionSum(a) ||
    b.sharpness - a.sharpness,
)[0];

const draft = {
  title: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  location: '',
  date: dateText,
  start: first.day,
  draft: true,
  blurb: '',
  cover: cover?.name,
  captions: Object.fromEntries(kept.filter((p) => p.ai?.caption).map((p) => [p.name, p.ai.caption])),
  alt: Object.fromEntries(kept.filter((p) => p.ai?.alt).map((p) => [p.name, p.ai.alt])),
  exclude: photos.filter((p) => p.drop).map((p) => p.name),
  entries: days.map(([day, list]) => ({
    label: dayLabel(day),
    title: dayTitles[day] ?? '',
    text: [],
    photos: list.map((p) => p.name),
  })),
};
if (!Object.keys(draft.captions).length) delete draft.captions;
if (!Object.keys(draft.alt).length) delete draft.alt;

// -- write the report and (if safe) the draft trip file
const report = {
  generatedAt: new Date().toISOString(),
  model: useAi ? MODEL : null,
  medianSharpness: median,
  photos: photos.map(({ hash, _size, _mtimeMs, ...rest }) => ({ ...rest, hash: hash.toString(16) })),
};
fs.writeFileSync(path.join(tripSrc, 'curation.json'), JSON.stringify(report, null, 2) + '\n');

fs.mkdirSync(TRIPS_DIR, { recursive: true });
const tripFile = path.join(TRIPS_DIR, `${slug}.json`);
let wroteTrip = false;
if (!fs.existsSync(tripFile) || rewrite) {
  if (fs.existsSync(tripFile)) {
    const backup = path.join(tripSrc, `trip.backup-${Date.now()}.json`);
    fs.copyFileSync(tripFile, backup);
    console.log(`Backed up the previous trip file to ${path.relative(projectRoot, backup)}`);
  }
  fs.writeFileSync(tripFile, JSON.stringify(draft, null, 2) + '\n');
  wroteTrip = true;
}

// ----------------------------------------------------------------- summary

const dropped = photos.filter((p) => p.drop);
const noExif = photos.filter((p) => p.timeSource === 'placed-by-file-name').length;
const allMtime = photos.every((p) => p.timeSource === 'file-modified-time');
console.log(`\n${photos.length} photos -> ${kept.length} kept across ${days.length} day(s), ${dropped.length} suggested drops.`);
for (const [day, list] of days) {
  console.log(`  ${dayLabel(day)}: ${list.length} photos${dayTitles[day] ? `  "${dayTitles[day]}"` : ''}`);
}
if (dropped.length) {
  console.log('\nSuggested drops (listed under "exclude" in the trip file; remove a name to keep that photo):');
  for (const p of dropped) console.log(`  ${p.name}: ${p.drop}`);
}
if (allMtime) {
  console.log('\nNo photo had an EXIF capture time, so everything was ordered by file modified time. Check the days.');
} else if (noExif) {
  console.log(`\n${noExif} photos had no EXIF capture time and were placed next to the previous photo by file name. Check their days.`);
}
const heroes = kept.filter((p) => p.ai?.quality === 5);
if (heroes.length) {
  console.log(`\nTop gallery shots (${heroes.length} photo(s) rated 5/5):`);
  for (const p of heroes) {
    const s = p.ai?.strengths?.length ? ` [${p.ai.strengths.join(', ')}]` : '';
    console.log(`  ${p.name}: ${p.ai?.caption ?? ''}${s}`);
  }
}

const lowRated = kept.filter((p) => p.ai?.quality && p.ai.quality <= 2);
if (lowRated.length) {
  console.log(`\nThe AI rated ${lowRated.length} kept photos 1-2 out of 5 (not excluded; worth a look): ${lowRated.map((p) => p.name).join(', ')}`);
}
if (useAi) console.log(`\n${usageSummary()}`);

console.log(
  wroteTrip
    ? `\nWrote draft: src/data/trips/${slug}.json  (full report: photos-src/${slug}/curation.json)`
    : `\nsrc/data/trips/${slug}.json already exists, so it was NOT changed. Report: photos-src/${slug}/curation.json\nUse --rewrite to regenerate it (the old file is backed up first).`,
);
console.log(
  [
    '\nNext:',
    `  1. Edit src/data/trips/${slug}.json: fill in location, blurb and the diary text; fix titles.`,
    `  2. pnpm build:photos`,
    `  3. pnpm dev   (drafts are visible in dev), then delete the "draft" line to publish.`,
  ].join('\n'),
);
