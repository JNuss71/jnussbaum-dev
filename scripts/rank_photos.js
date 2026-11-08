// Second curation pass: rank photos against each other instead of one at a time.
//
//   photos-src/<slug>/curation.json   per-photo scores from curate_photos.js --ai
//        |
//        v
//   photos-src/<slug>/ranking.json    per-day order, overall order, reliability stats, comparison notes
//   src/data/trips/<slug>.json        highlights selected, captions/alt/cover updated
//
// Usage:  pnpm rank:photos <slug> [--model <id>] [--dry]
//
// Why: a model grading one photo at a time has nothing to compare against, so its grades
// bunch up. Seeing a day's best candidates side by side is how a critique works.
//
// How:
//  - Each day, the top 40% by score (at least 12, at most 48) become candidates.
//  - Candidates are dealt into groups of up to 12. The top 4 of every group meet in a final
//    round of up to 16, so a day's top 16 have all been compared directly with each other.
//  - Every comparison is run twice, with the photos shown in a shuffled order and then in the
//    reverse of it. A photo's place is its average position across both runs, which cancels
//    out any preference the model has for a position in the list.
//  - The best 2 of every day are then ranked the same way to pick the trip's best and the cover.
//
// Reliability report (printed and saved to ranking.json):
//  - Self-agreement: overlap between the two runs' top picks, against what chance would give.
//    High means real preferences; near chance means the order is noise.
//  - Change from scores: how many selected photos would not have been chosen by score alone.
//
// Results are cached in photos-src/<slug>/.rank-cache.json, so re-runs are free.
// --dry   rank and write ranking.json, but do not touch the trip file.
// Title, location, blurb, day titles and diary text in the trip file are never changed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_MODEL, RANK_SCHEMA, RANK_SYSTEM, gemini, usageSummary } from './lib/photo_critique.js';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('This script needs sharp. Install it once with:  pnpm add -D sharp');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
const MODEL = option('--model') ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
const DRY = args.includes('--dry');
const API_KEY = process.env.GEMINI_API_KEY;

if (!slug) {
  console.error('Usage: pnpm rank:photos <trip-slug> [--model <id>] [--dry]');
  process.exit(1);
}
if (!API_KEY) {
  console.error('Needs a Gemini API key in GEMINI_API_KEY.');
  process.exit(1);
}

const tripSrc = path.join(projectRoot, 'photos-src', slug);
const curationPath = path.join(tripSrc, 'curation.json');
const tripPath = path.join(projectRoot, 'src', 'data', 'trips', `${slug}.json`);
const cachePath = path.join(tripSrc, '.rank-cache.json');
for (const p of [curationPath, tripPath]) {
  if (!fs.existsSync(p)) {
    console.error(`Missing ${path.relative(projectRoot, p)}. Run  pnpm curate:photos ${slug} --ai  first.`);
    process.exit(1);
  }
}

const RANK_VERSION = 3; // bump to invalidate cached rankings
const GROUP = 12; // photos per group-stage comparison
const FINAL_MAX = 20; // largest set ranked in a single comparison
const ADVANCE = 5; // unique winners from each group into the final round
const RANK_WIDTH = 768; // smaller than the scoring pass: many images per request
const CONCURRENCY = 12;

// ------------------------------------------------------------------ data

const curation = JSON.parse(fs.readFileSync(curationPath, 'utf-8'));
const trip = JSON.parse(fs.readFileSync(tripPath, 'utf-8'));
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf-8')) : {};

const kept = curation.photos.filter((p) => !p.drop && p.ai?.quality);
if (kept.length === 0) {
  console.error(`No AI scores in curation.json. Run  pnpm curate:photos ${slug} --ai  first.`);
  process.exit(1);
}

/** Overall grade dominates; criterion grades break ties; sharpness breaks the rest. */
const criteriaOf = (p) => {
  const s = p.ai.scores ?? {};
  return (s.intent ?? 0) + (s.composition ?? 0) + (s.light ?? 0) + (s.moment ?? 0) + (s.craft ?? 0);
};
const meetsFloor = (p) => p.ai.quality >= 3 && criteriaOf(p) >= 15;
const scoreOf = (p) => p.ai.quality * 100 + criteriaOf(p) * 4 + Math.min(p.sharpness ?? 0, 80) / 80;
const byScore = (a, b) => scoreOf(b) - scoreOf(a);

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

/** Deterministic shuffle, seeded by the group's contents, so re-runs hit the cache. */
function shuffled(list) {
  let h = 2166136261;
  for (const ch of list.map((p) => p.name).sort().join(',')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --------------------------------------------------------------- ranking

const thumbs = new Map();
async function thumb(p) {
  if (!thumbs.has(p.name)) {
    const buf = await sharp(path.join(tripSrc, p.file), { failOn: 'none' })
      .rotate()
      .resize({ width: RANK_WIDTH, height: RANK_WIDTH, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }) // metadata (EXIF, GPS) is dropped
      .toBuffer();
    thumbs.set(p.name, buf.toString('base64'));
  }
  return thumbs.get(p.name);
}

const notes = []; // the model's comparison notes, saved to ranking.json
const agreement = []; // one entry per comparison: how well the two runs agreed
const aiDuplicates = new Map(); // weakerName -> Set of strongerNames the AI saw side-by-side and marked redundant

/** One request: the photos in exactly this order. Returns them strongest first, or null. */
async function rankOnce(shown, context) {
  const key = `${MODEL}|v${RANK_VERSION}|${shown.map((p) => p.name).join(',')}`;
  let out = cache[key];
  if (!out) {
    const parts = [{ text: `${shown.length} photographs from ${context}.` }];
    for (const [i, p] of shown.entries()) {
      parts.push({ text: `Photo ${i + 1}:` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: await thumb(p) } });
    }
    parts.push({ text: `Order all ${shown.length} photos from strongest to weakest.` });
    out = await gemini({ model: MODEL, apiKey: API_KEY, system: RANK_SYSTEM, schema: RANK_SCHEMA, parts, maxOutputTokens: 16384 });
    if (out) {
      cache[key] = out;
      fs.writeFileSync(cachePath, JSON.stringify(cache));
    }
  }
  if (!out) return null;
  const dupes = [];
  for (const d of out.duplicates ?? []) {
    const w = shown[d.weaker - 1];
    const s = shown[d.stronger - 1];
    if (w && s && w.name !== s.name) {
      if (!aiDuplicates.has(w.name)) aiDuplicates.set(w.name, new Set());
      if (!aiDuplicates.has(s.name)) aiDuplicates.set(s.name, new Set());
      aiDuplicates.get(w.name).add(s.name);
      aiDuplicates.get(s.name).add(w.name);
      dupes.push({ weaker: w.name, stronger: s.name });
    }
  }
  notes.push({ context, shown: shown.map((p) => p.name), comparison: out.comparison, duplicates: dupes });

  // The model's order, ignoring bad numbers; anything it left out goes last.
  const seen = new Set();
  const order = [];
  for (const n of out.ranking ?? []) {
    const p = shown[n - 1];
    if (Number.isInteger(n) && p && !seen.has(p.name)) {
      seen.add(p.name);
      order.push(p);
    }
  }
  return [...order, ...shown.filter((p) => !seen.has(p.name))];
}

const deduplicated = []; // redundant takes removed after ranking
const lensCache = new Map();

/** Reads EXIF FocalLength + FNumber (e.g. "2.02/1.70" vs "6.90/1.68" vs "17.91/2.80") from the first 64 KB. */
function lensOf(p) {
  if (lensCache.has(p.name)) return lensCache.get(p.name);
  let sig = '';
  try {
    const fd = fs.openSync(path.join(tripSrc, p.file), 'r');
    const buf = Buffer.allocUnsafe(65536);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const slice = buf.subarray(0, bytes);
    const start = slice.indexOf('Exif\0\0');
    if (start >= 0) {
      const tiff = slice.subarray(start + 6);
      const le = tiff.toString('latin1', 0, 2) === 'II';
      const u16 = (pos) => (le ? tiff.readUInt16LE(pos) : tiff.readUInt16BE(pos));
      const u32 = (pos) => (le ? tiff.readUInt32LE(pos) : tiff.readUInt32BE(pos));
      const ifd0 = u32(4);
      const n0 = u16(ifd0);
      let exifOff = 0;
      for (let i = 0; i < n0; i++) {
        const e = ifd0 + 2 + i * 12;
        if (u16(e) === 0x8769) exifOff = u32(e + 8);
      }
      if (exifOff) {
        const ne = u16(exifOff);
        let fl = '';
        let fn = '';
        for (let i = 0; i < ne; i++) {
          const e = exifOff + 2 + i * 12;
          const tag = u16(e);
          if (tag === 0x920a) {
            const pos = u32(e + 8);
            fl = (u32(pos) / u32(pos + 4)).toFixed(2);
          } else if (tag === 0x829d) {
            const pos = u32(e + 8);
            fn = (u32(pos) / u32(pos + 4)).toFixed(2);
          }
        }
        sig = `${fl}/${fn}`;
      }
    }
  } catch {
    sig = '';
  }
  lensCache.set(p.name, sig);
  return sig;
}

/** True only when two AI-flagged duplicates are a same-lens, same-orientation burst take (not an additive lens/framing change). */
function isBurstTake(a, b) {
  if (!a || !b) return false;
  const dtSec = Math.abs(a.ts - b.ts) / 1000;
  const sameOrient = a.width > a.height === b.width > b.height;
  const sameLens = lensOf(a) === lensOf(b);
  return dtSec <= 90 && sameOrient && sameLens;
}

/** Walks a ranked list from strongest to weakest, dropping any photo the AI marked as redundant with a higher-ranked photo. */
function dedupeRanked(ordered, context) {
  const keptHigher = new Map();
  const unique = [];
  for (const p of ordered) {
    const stronger = [...(aiDuplicates.get(p.name) ?? [])].find(
      (s) => keptHigher.has(s) && isBurstTake(p, keptHigher.get(s)),
    );
    if (stronger) {
      const prev = keptHigher.get(stronger);
      // If a lower-grade burst take (e.g. 3/5) ranked ahead of a higher-grade take (e.g. 4/5),
      // swap in the higher-grade take so the burst cluster is represented by its best version.
      if ((p.ai?.quality ?? 0) > (prev.ai?.quality ?? 0)) {
        const idx = unique.indexOf(prev);
        if (idx >= 0) unique[idx] = p;
        keptHigher.delete(stronger);
        keptHigher.set(p.name, p);
        deduplicated.push({ context, dropped: stronger, duplicateOf: p.name });
      } else {
        deduplicated.push({ context, dropped: p.name, duplicateOf: stronger });
      }
    } else {
      keptHigher.set(p.name, p);
      unique.push(p);
    }
  }
  return unique;
}

/** Ranks a set twice (shuffled, then reversed), averages positions, and removes redundant takes. Strongest first. */
async function rankGroup(list, context) {
  if (list.length <= 1) return list;
  const a = shuffled(list);
  const b = [...a].reverse();
  const [ra, rb] = await Promise.all([rankOnce(a, context), rankOnce(b, context)]);
  const runs = [ra, rb].filter(Boolean);
  if (runs.length === 0) {
    console.warn(`  (no usable ranking for a group in ${context}; keeping score order)`);
    return [...list].sort(byScore);
  }

  if (runs.length === 2 && list.length >= 3) {
    const k = Math.min(ADVANCE, Math.floor(list.length / 2));
    const topA = new Set(ra.slice(0, k).map((p) => p.name));
    const overlap = rb.slice(0, k).filter((p) => topA.has(p.name)).length;
    agreement.push({ context, size: list.length, k, overlap, chance: (k * k) / list.length });
  }

  const pos = new Map(list.map((p) => [p.name, 0]));
  for (const run of runs) run.forEach((p, i) => pos.set(p.name, pos.get(p.name) + i / runs.length));
  const ordered = [...list].sort((x, y) => pos.get(x.name) - pos.get(y.name) || byScore(x, y));
  return dedupeRanked(ordered, context);
}

/** Group stage + final round. Returns unique finalists, strongest first. */
async function tournament(list, context) {
  if (list.length <= FINAL_MAX) return rankGroup(list, context);

  // Group chronologically so burst shots and repeated takes from the same viewpoint
  // land in the same group and are compared directly against each other in Round 1.
  const byTime = [...list].sort((a, b) => a.ts - b.ts);
  const groupCount = Math.ceil(byTime.length / GROUP);
  const chunkSize = Math.ceil(byTime.length / groupCount);
  const groups = [];
  for (let i = 0; i < byTime.length; i += chunkSize) {
    groups.push(byTime.slice(i, i + chunkSize));
  }

  const ranked = await pool(groups, CONCURRENCY, (g) => rankGroup(g, context));
  // Advance up to ADVANCE scene-distinct representatives per group into the final round,
  // while attaching additive (different-lens/framing) takes right after their scene partner.
  const finalists = [];
  const companions = new Map(); // repName -> additive takes from the same group
  const rest = [];
  for (const g of ranked) {
    const seenScene = new Set();
    let count = 0;
    for (const p of g) {
      const rep = [...(aiDuplicates.get(p.name) ?? [])].find((s) => seenScene.has(s));
      if (!rep && count < ADVANCE) {
        seenScene.add(p.name);
        finalists.push(p);
        count++;
      } else if (rep) {
        if (!companions.has(rep)) companions.set(rep, []);
        companions.get(rep).push(p);
      } else {
        rest.push(p);
      }
    }
  }
  const top = await tournament(finalists, `${context}, final round`);
  const withCompanions = top.flatMap((p) => [p, ...(companions.get(p.name) ?? [])]);
  return dedupeRanked([...withCompanions, ...rest.sort(byScore)], `${context}, combined`);
}

// ------------------------------------------------------------------ main

const days = [...Map.groupBy(kept, (p) => p.day)].sort(([a], [b]) => a.localeCompare(b));

/** How many candidates from a day go into the comparison. */
const candidateCount = (n) => Math.min(n, Math.max(GROUP, Math.ceil(n * 0.4)), 48);

/** How many photos from a day end up on the page (never more than FINAL_MAX, all directly compared). */
const keepCount = (n) => (n <= 10 ? n : Math.min(14, Math.max(8, Math.round(n * 0.1))));

console.log(`Ranking ${days.length} days with ${MODEL} (each comparison runs twice) ...`);
const dayOrder = {};
await pool(days, 4, async ([day, list]) => {
  const candidates = [...list].sort(byScore).slice(0, candidateCount(list.length));
  dayOrder[day] = await tournament(candidates, `one day of the trip (${day})`);
});

const allTopGrade = days.flatMap(([day]) => dayOrder[day].filter((p) => (p.ai?.quality ?? 0) >= 4));
const dayBest =
  allTopGrade.length > 0
    ? allTopGrade
    : days.flatMap(([day]) => {
        const seen = new Set();
        return dayOrder[day]
          .filter((p) => {
            if ([...(aiDuplicates.get(p.name) ?? [])].some((s) => seen.has(s))) return false;
            seen.add(p.name);
            return true;
          })
          .slice(0, 2);
      });
console.log(`Ranking the ${dayBest.length} best photos across all days ...`);
const overall = await tournament(dayBest, 'the whole trip, all 4/5+ photos');

// -- selection
const selected = new Set();
let changedFromScores = 0;
for (const [day, list] of days) {
  const ranked = dayOrder[day];
  const aboveFloor = ranked.filter(meetsFloor);
  // Enforce the 15/25 (and 3/5) floor, keeping the single best photo if a day has none above the floor.
  const picks = (aboveFloor.length > 0 ? aboveFloor : ranked.slice(0, 1)).slice(0, keepCount(list.length));
  const byScoreTop = new Set([...list].sort(byScore).slice(0, picks.length).map((p) => p.name));
  changedFromScores += picks.filter((p) => !byScoreTop.has(p.name)).length;
  for (const p of picks) selected.add(p.name);
}

// -- reliability
const totalK = agreement.reduce((a, g) => a + g.k, 0);
const totalOverlap = agreement.reduce((a, g) => a + g.overlap, 0);
const totalChance = agreement.reduce((a, g) => a + g.chance, 0);
const reliability = {
  comparisons: agreement.length,
  topPickAgreement: totalK ? totalOverlap / totalK : null,
  chanceAgreement: totalK ? totalChance / totalK : null,
  selectedNotTopByScore: changedFromScores,
  selected: selected.size,
};

const ranking = {
  generatedAt: new Date().toISOString(),
  model: MODEL,
  reliability,
  overall: overall.map((p) => p.name),
  days: Object.fromEntries(days.map(([day]) => [day, dayOrder[day].map((p) => p.name)])),
  selected: [...selected],
  deduplicated,
  agreement,
  notes,
};
fs.writeFileSync(path.join(tripSrc, 'ranking.json'), JSON.stringify(ranking, null, 2) + '\n');

// -- trip file
const dayOfName = new Map(curation.photos.map((p) => [p.name, p.day]));
const keptByTime = [...kept].sort((a, b) => a.ts - b.ts);

if (!DRY) {
  const backup = path.join(tripSrc, `trip.backup-${Date.now()}.json`);
  fs.copyFileSync(tripPath, backup);

  const entryDay = (entry) => entry.photos.map((n) => dayOfName.get(n)).find(Boolean);
  const entriesByDay = new Map(trip.entries.map((e) => [entryDay(e), e]));
  trip.entries = days.map(([day]) => {
    const entry = entriesByDay.get(day) ?? { label: day, title: '', text: [] };
    return { ...entry, photos: keptByTime.filter((p) => p.day === day && selected.has(p.name)).map((p) => p.name) };
  });
  trip.cover = overall[0]?.name ?? trip.cover;
  trip.captions = Object.fromEntries(keptByTime.filter((p) => p.ai.caption).map((p) => [p.name, p.ai.caption]));
  trip.alt = Object.fromEntries(keptByTime.filter((p) => p.ai.alt).map((p) => [p.name, p.ai.alt]));
  trip.scores = Object.fromEntries(
    keptByTime.map((p) => {
      const s = p.ai.scores ?? {};
      const sum25 = (s.intent ?? 0) + (s.composition ?? 0) + (s.light ?? 0) + (s.moment ?? 0) + (s.craft ?? 0);
      const rankIdx = (dayOrder[p.day] ?? []).findIndex((x) => x.name === p.name);
      const rankTag = rankIdx >= 0 ? `#${rankIdx + 1} · ` : '';
      return [p.name, `${rankTag}${p.ai.quality}/5 · ${sum25}/25`];
    }),
  );
  trip.exclude = curation.photos.map((p) => p.name).filter((n) => !selected.has(n));

  fs.writeFileSync(tripPath, JSON.stringify(trip, null, 2) + '\n');
  console.log(`Backed up the previous trip file to ${path.relative(projectRoot, backup)}`);
}

// ---------------------------------------------------------------- summary

const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const grades = Map.groupBy(kept, (p) => p.ai.quality);
console.log(`\nScores: ${[5, 4, 3, 2, 1].map((g) => `${g}: ${grades.get(g)?.length ?? 0}`).join(', ')}`);
console.log(`Selected ${selected.size} of ${kept.length} kept photos.`);
for (const [day, list] of days) {
  const n = [...selected].filter((x) => dayOfName.get(x) === day).length;
  console.log(`  ${day}: ${n} of ${list.length}`);
}
console.log('\nReliability:');
console.log(
  `  Self-agreement on top picks: ${pct(reliability.topPickAgreement)} across ${agreement.length} comparisons ` +
    `(chance would be ${pct(reliability.chanceAgreement)})`,
);
console.log(`  Selected photos that score order alone would not have picked: ${changedFromScores} of ${selected.size}`);
console.log(`  Redundant takes visually removed after ranking: ${deduplicated.length}`);
console.log('\nBest across the trip:');
for (const p of overall.slice(0, 10)) {
  console.log(`  ${p.name}  [${p.ai.quality}/5, ${p.ai.genre ?? '?'}]  ${p.ai.caption ?? ''}`);
}
console.log(`\nCover: ${overall[0]?.name}`);
console.log(`\n${usageSummary()}`);
console.log(`Details and comparison notes: photos-src/${slug}/ranking.json`);
if (DRY) console.log('Dry run: the trip file was not changed.');
