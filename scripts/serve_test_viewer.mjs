import http from 'http';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
sharp.cache(true);

const PORT = process.env.PORT || 3333;
const ROOT_DIR = process.cwd();
const TRIP_DIR = path.join(ROOT_DIR, 'photos-src', 'berlin-poland-tatra');
const ORIG_DIR = path.join(TRIP_DIR, '.originals');
const USER_EDITS_DIR = path.join(TRIP_DIR, '.user_edits');
const EDITS_LOG_PATH = path.join(USER_EDITS_DIR, 'edits_log.json');
const CURATION_PATH = path.join(TRIP_DIR, 'curation.json');
const TRIP_JSON_PATH = path.join(ROOT_DIR, 'src', 'data', 'trips', 'berlin-poland-tatra.json');
const THUMB_CACHE_DIR = path.join(ROOT_DIR, '.cache', 'viewer_thumbs');

if (!fs.existsSync(THUMB_CACHE_DIR)) {
  fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(USER_EDITS_DIR)) {
  fs.mkdirSync(USER_EDITS_DIR, { recursive: true });
}

// Load photo critique module for live AI rescoring
let critiqueModule = null;
try {
  critiqueModule = await import(pathToFileURL(path.join(ROOT_DIR, 'scripts', 'lib', 'photo_critique.js')).href);
} catch (e) {
  console.warn('[Viewer] Note: photo_critique.js not loaded:', e.message);
}
const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyAmOQeWLgWSJXINOfZLdRS4e72W4SXumEI';

// Load and index curation data
function loadCuration() {
  const raw = fs.readFileSync(CURATION_PATH, 'utf8');
  const data = JSON.parse(raw);

  let tripData = null;
  try {
    if (fs.existsSync(TRIP_JSON_PATH)) {
      tripData = JSON.parse(fs.readFileSync(TRIP_JSON_PATH, 'utf8'));
    }
  } catch {}

  const photos = data.photos.map((p) => {
    const scores = p.ai?.scores || {};
    const sum = (scores.intent || 0) + (scores.composition || 0) + (scores.light || 0) + (scores.moment || 0) + (scores.craft || 0);
    const prevScores = p.prevAi?.scores || {};
    const prevSum = p.prevAi ? (prevScores.intent || 0) + (prevScores.composition || 0) + (prevScores.light || 0) + (prevScores.moment || 0) + (prevScores.craft || 0) : null;
    
    const baseId = p.file.replace(/\.(jpg|jpeg|png)$/i, '');
    const isExcluded = tripData?.exclude ? tripData.exclude.includes(baseId) : false;

    // Resolve matching day entry for diary text
    let matchedEntry = null;
    if (tripData?.entries) {
      matchedEntry = tripData.entries.find(e => e.photos && e.photos.includes(baseId));
      if (!matchedEntry && p.day) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const parts = p.day.split('-');
        if (parts.length === 3) {
          const mIdx = parseInt(parts[1], 10) - 1;
          const dayNum = parseInt(parts[2], 10);
          const labelSub = `${months[mIdx]} ${dayNum}`;
          matchedEntry = tripData.entries.find(e => e.label && e.label.includes(labelSub));
        }
      }
    }

    const dayLabel = matchedEntry?.label || '';
    const dayTitle = matchedEntry?.title || '';
    const dayStats = matchedEntry?.stats || '';
    const dayStory = Array.isArray(matchedEntry?.text) ? matchedEntry.text.join('\n\n') : (matchedEntry?.text || '');
    const caption = (tripData?.captions && tripData.captions[baseId]) || p.userCaption || p.ai?.caption || '';

    return {
      id: p.file,
      name: p.name || p.file,
      file: p.file,
      baseId,
      width: p.width,
      height: p.height,
      aspect: p.aspect || (p.width && p.height ? +(p.width / p.height).toFixed(3) : 1),
      time: p.time,
      day: p.day,
      dayLabel,
      dayTitle,
      dayStats,
      dayStory,
      isExcluded,
      sharpness: p.sharpness,
      brightness: p.brightness,
      quality: p.ai?.quality ?? 0,
      totalScore: sum,
      scores: scores,
      genre: p.ai?.genre || 'other',
      issues: p.ai?.issues || [],
      strengths: p.ai?.strengths || [],
      critique: p.ai?.critique || '',
      caption: caption,
      alt: p.ai?.alt || '',
      isEdited: Boolean(p.prevAi),
      prevQuality: p.prevAi?.quality ?? null,
      prevTotalScore: prevSum,
      prevScores: prevScores,
      flaggedForReview: p.flaggedForReview || null,
      tieResolution: p.tieResolution || null,
      top82Rank: p.top82Rank || null,
      top82Elo: p.top82Elo || null,
      hasOriginal: fs.existsSync(path.join(ORIG_DIR, p.file)),
      hasUserEdit: fs.existsSync(path.join(USER_EDITS_DIR, p.file)),
    };
  });

  photos.sort((a, b) => (b.totalScore - a.totalScore) || (b.quality - a.quality) || ((b.time || '').localeCompare(a.time || '')));
  return photos;
}

let cachedPhotos = loadCuration();

fs.watchFile(CURATION_PATH, { interval: 2000 }, () => {
  try {
    console.log('[Viewer] curation.json updated, refreshing catalog...');
    cachedPhotos = loadCuration();
  } catch (err) {
    console.error('[Viewer] Failed to reload curation.json:', err);
  }
});

if (fs.existsSync(TRIP_JSON_PATH)) {
  fs.watchFile(TRIP_JSON_PATH, { interval: 2000 }, () => {
    try {
      console.log('[Viewer] berlin-poland-tatra.json updated, refreshing catalog...');
      cachedPhotos = loadCuration();
    } catch {}
  });
}

async function getThumbnail(filename) {
  const thumbPath = path.join(THUMB_CACHE_DIR, `${filename}.webp`);
  if (fs.existsSync(thumbPath)) {
    return fs.readFileSync(thumbPath);
  }

  const srcPath = path.join(TRIP_DIR, filename);
  if (!fs.existsSync(srcPath)) return null;

  try {
    const buf = await sharp(srcPath)
      .resize({ width: 450, height: 450, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    fs.writeFileSync(thumbPath, buf);
    return buf;
  } catch (err) {
    console.error(`[Viewer] Thumb generation error for ${filename}:`, err);
    return null;
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photo Curation & Straightener Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #18181b; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
    .toast-anim { animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex flex-col antialiased selection:bg-indigo-500 selection:text-white">

  <!-- TOP HEADER -->
  <header class="sticky top-0 z-30 bg-zinc-900/90 backdrop-blur-md border-b border-zinc-800 px-4 lg:px-8 py-3.5 shadow-lg">
    <div class="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
          📷
        </div>
        <div>
          <h1 class="text-base font-semibold text-white tracking-tight flex items-center gap-2">
            Photo Curation & Studio
            <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700/60" id="totalCountBadge">...</span>
          </h1>
          <p class="text-xs text-zinc-400">Sorted by score · Click photo ID to copy · Inspect to level & crop</p>
        </div>
      </div>

      <!-- Live Search & Sort -->
      <div class="flex flex-wrap items-center gap-2.5">
        <div class="relative flex-1 sm:w-64">
          <input 
            type="text" 
            id="searchInput" 
            placeholder="Search filename, critique, caption..." 
            class="w-full bg-zinc-950/80 border border-zinc-700/80 rounded-lg px-3 py-1.5 pl-8 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
          >
          <svg class="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>

        <select id="sortSelect" class="bg-zinc-950/80 border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 transition">
          <option value="top82_rank">🏆 Top 82 Ranked (#1 → #82)</option>
          <option value="score_desc">Score: High → Low</option>
          <option value="score_asc">Score: Low → High</option>
          <option value="quality_desc">Quality (5★ → 1★)</option>
          <option value="craft_desc">Craft Score (High → Low)</option>
          <option value="time_asc">Timeline (Oldest First)</option>
          <option value="time_desc">Timeline (Newest First)</option>
          <option value="file_asc">Filename (A → Z)</option>
        </select>

        <button id="viewToggleBtn" title="Toggle Compact / Detailed" class="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 transition flex items-center gap-1.5">
          <span id="viewToggleIcon">⊞</span> <span id="viewToggleText">Detailed</span>
        </button>
      </div>
    </div>

    <!-- FILTER BAR -->
    <div class="max-w-7xl mx-auto flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-zinc-800/60 text-xs">
      <span class="text-zinc-500 font-medium mr-1">Filter:</span>
      
      <button class="filter-btn active px-2.5 py-1 rounded-md border border-indigo-500/60 bg-indigo-500/20 text-indigo-300 transition" data-filter="all">All Photos</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/70 transition font-medium" data-filter="top82">🏆 Top 82 Ranked (<span id="cntTop82">82</span>)</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition" data-filter="q45">⭐ Quality 4 & 5 (<span id="cntQ45">0</span>)</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition" data-filter="edited">✏️ Kept Edits (<span id="cntEdited">0</span>)</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition" data-filter="ties">🚩 Flagged Ties (<span id="cntTies">0</span>)</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition" data-filter="tilted">📐 Tilted Horizon</button>
      <button class="filter-btn px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition" data-filter="crop_issue">✂️ Edge/Crop Issue</button>

      <div class="ml-auto flex items-center gap-3 text-zinc-400">
        <span id="filteredCountText">Showing 0 photos</span>
        <div id="topPagination" class="hidden sm:flex items-center gap-1.5 bg-zinc-950/80 border border-zinc-800 rounded-lg px-2 py-0.5">
          <button id="topPrevBtn" class="px-2 py-0.5 text-zinc-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none font-medium">‹</button>
          <span id="topPageStats" class="font-mono text-[11px] text-zinc-300 px-1">1 / 1</span>
          <button id="topNextBtn" class="px-2 py-0.5 text-zinc-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none font-medium">›</button>
        </div>
      </div>
    </div>
  </header>

  <!-- MAIN PHOTO GRID -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 pb-72">
    <div id="photosContainer" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      <!-- Injected via JavaScript -->
    </div>
    
    <div id="noResults" class="hidden text-center py-20 text-zinc-500">
      <div class="text-4xl mb-3">🔍</div>
      <p class="text-base font-medium text-zinc-400">No photos match your current search or filters.</p>
      <button onclick="resetFilters()" class="mt-3 text-xs text-indigo-400 hover:underline">Reset filters</button>
    </div>

    <!-- Pagination Controls -->
    <div id="paginationBar" class="mt-14 mb-24 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-zinc-800/80 pt-8 pb-4 text-xs text-zinc-400 bg-zinc-950/40 p-4 rounded-xl border">
      <div id="pageStats" class="font-medium text-zinc-300">Page 1 of 1</div>
      <div class="flex items-center gap-2">
        <button id="prevPageBtn" class="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700/80 text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition font-medium shadow-sm">← Previous Page</button>
        <span id="pageNumbers" class="flex items-center gap-1 font-mono px-3 py-1 bg-zinc-950 border border-zinc-800 rounded-lg"></span>
        <button id="nextPageBtn" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-30 disabled:pointer-events-none transition shadow-sm">Next Page →</button>
      </div>
    </div>
  </main>

  <!-- DOCKED BOTTOM COPY QUEUE DRAWER -->
  <aside id="queueTray" class="fixed bottom-0 inset-x-0 z-40 bg-zinc-900/95 backdrop-blur-md border-t border-indigo-500/40 shadow-2xl transition-all duration-300">
    <div class="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between border-b border-zinc-800/60 text-xs">
      <div class="flex items-center gap-2">
        <div class="w-5 h-5 rounded bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-[10px] border border-indigo-500/30">
          📋
        </div>
        <span class="font-semibold text-white">Copy Queue:</span>
        <span id="queueCount" class="text-indigo-400 font-mono font-medium">0 selected</span>
        <span class="hidden sm:inline text-zinc-500 text-[11px]">· Click any filename to copy or card checkbox to add</span>
      </div>

      <div class="flex items-center gap-2">
        <button id="toggleTrayBtn" class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] transition flex items-center gap-1">
          <span id="toggleTrayIcon">▼</span> <span id="toggleTrayText">Minimize</span>
        </button>
      </div>
    </div>

    <div id="trayContent" class="max-w-7xl mx-auto p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div id="queueChips" class="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-1 text-xs flex-1 min-w-0">
        <!-- chips dynamically populated -->
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button id="copySpaceBtn" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5">
          <span>Copy Filenames</span>
        </button>
        <button id="copyMarkdownBtn" class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs transition flex items-center gap-1.5" title="Copy markdown bullet list with scores and details">
          <span>Copy Markdown List</span>
        </button>
        <button id="clearQueueBtn" class="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/40 border border-zinc-800 hover:border-red-800/50 text-zinc-400 hover:text-red-300 text-xs transition">
          Clear
        </button>
      </div>
    </div>
  </aside>

  <!-- LIGHTBOX / INSPECT MODAL -->
  <div id="lightbox" class="fixed inset-0 z-50 bg-black/90 backdrop-blur-md hidden flex flex-col items-center justify-center p-4">
    <button onclick="closeLightbox()" class="absolute top-4 right-4 text-zinc-400 hover:text-white text-2xl z-50 p-2">✕</button>
    <div class="max-w-6xl w-full max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col lg:flex-row shadow-2xl">
      <div class="flex-1 bg-black flex items-center justify-center relative min-h-[300px] lg:min-h-[500px] p-2 select-none">
        <img id="lightboxImg" src="" alt="" class="max-h-[80vh] max-w-full object-contain">

        <button id="lbArrowPrev" class="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-900/85 hover:bg-indigo-600 text-white flex items-center justify-center text-2xl backdrop-blur border border-zinc-700/80 shadow-2xl transition hover:scale-105 active:scale-95 z-20" title="Previous photo (← arrow)">‹</button>
        <button id="lbArrowNext" class="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-900/85 hover:bg-indigo-600 text-white flex items-center justify-center text-2xl backdrop-blur border border-zinc-700/80 shadow-2xl transition hover:scale-105 active:scale-95 z-20" title="Next photo (→ arrow)">›</button>

        <div id="lightboxDiffBtn" class="hidden absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer select-none">
          Hold to see Original
        </div>
      </div>

      <div class="w-full lg:w-96 p-6 border-t lg:border-t-0 lg:border-l border-zinc-800 overflow-y-auto custom-scrollbar flex flex-col gap-4">
        <div class="flex items-center justify-between pb-3 border-b border-zinc-800/80 text-xs">
          <span id="lbCounter" class="font-mono text-zinc-400">Photo 1 of 1492</span>
          <div class="flex items-center gap-1.5">
            <button id="lbBtnPrev" class="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition font-medium">← Prev</button>
            <button id="lbBtnNext" class="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow transition">Next →</button>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between">
            <span id="lbQualityBadge" class="text-xs px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">★ 4</span>
            <span id="lbScoreBadge" class="text-sm font-bold text-emerald-400 font-mono">20/25</span>
          </div>
          <h2 id="lbFilename" class="text-sm font-mono font-semibold text-white mt-2 break-all select-all">PXL_...</h2>
          <p id="lbCaption" class="text-xs text-zinc-400 mt-1 italic"></p>
        </div>

        <div class="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs">
          <div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Scores Breakdown</div>
          <div class="grid grid-cols-5 gap-1.5 text-center font-mono">
            <div class="bg-zinc-900 p-1.5 rounded"><div class="text-[10px] text-zinc-500">INT</div><div id="lbScoreI" class="font-bold text-zinc-200">-</div></div>
            <div class="bg-zinc-900 p-1.5 rounded"><div class="text-[10px] text-zinc-500">COM</div><div id="lbScoreC" class="font-bold text-zinc-200">-</div></div>
            <div class="bg-zinc-900 p-1.5 rounded"><div class="text-[10px] text-zinc-500">LGT</div><div id="lbScoreL" class="font-bold text-zinc-200">-</div></div>
            <div class="bg-zinc-900 p-1.5 rounded"><div class="text-[10px] text-zinc-500">MOM</div><div id="lbScoreM" class="font-bold text-zinc-200">-</div></div>
            <div class="bg-zinc-900 p-1.5 rounded"><div class="text-[10px] text-zinc-500">CRF</div><div id="lbScoreCr" class="font-bold text-zinc-200">-</div></div>
          </div>
        </div>

        <div class="space-y-2 text-xs">
          <div id="lbIssuesContainer" class="flex flex-wrap gap-1"></div>
          <div id="lbStrengthsContainer" class="flex flex-wrap gap-1"></div>
        </div>

        <div class="text-xs">
          <div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Critique</div>
          <p id="lbCritique" class="text-zinc-300 leading-relaxed bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60"></p>
        </div>

        <!-- Travel Story & Caption Editor -->
        <div class="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 space-y-3 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-zinc-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <span>📖</span> Travel Story & Caption
            </span>
            <span id="lbDayLabelBadge" class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">Day --</span>
          </div>

          <div class="text-[11px] font-medium text-zinc-300" id="lbDayTitleDisplay">Day Title</div>

          <div>
            <label class="block text-[10px] font-medium text-zinc-400 mb-1">Day Narrative / Diary (Shown on Trip Page)</label>
            <textarea id="lbDayStoryInput" rows="3" class="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg p-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed custom-scrollbar" placeholder="Tell the story of this hike/journey..."></textarea>
          </div>

          <div>
            <label class="block text-[10px] font-medium text-zinc-400 mb-1">Photo Caption (Shown in Fullscreen Lightbox)</label>
            <textarea id="lbCaptionInput" rows="2" class="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg p-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed custom-scrollbar" placeholder="Caption for this photo..."></textarea>
          </div>

          <div class="flex items-center justify-between pt-1">
            <label class="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer select-none">
              <input type="checkbox" id="lbIncludeCheck" class="rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0">
              <span>Include in Website Gallery</span>
            </label>
          </div>

          <button id="lbSaveStoryBtn" onclick="saveStoryFromLightbox()" class="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/30 transition flex items-center justify-center gap-1.5 cursor-pointer">
            <span>💾</span> Save Story & Caption to Webapp
          </button>
        </div>

        <div class="mt-auto pt-3 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1">
          <div class="flex justify-between"><span>Dimensions:</span> <span id="lbDims" class="font-mono text-zinc-400"></span></div>
          <div class="flex justify-between"><span>Captured:</span> <span id="lbTime" class="font-mono text-zinc-400"></span></div>
          <div id="lbEditRow" class="flex justify-between text-indigo-400"><span>Edit Status:</span> <span id="lbEditStatus"></span></div>
        </div>

        <div class="space-y-2 pt-1">
          <button id="lbEditBtn" onclick="openEditor(currentLightboxFile)" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-2">
            <span>🎨 Open Straightener Studio</span>
          </button>
          <button id="lbQueueBtn" class="w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs border border-zinc-700 transition">
            + Add to Copy Queue
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- LIGHTROOM / GOOGLE PHOTOS STYLE CANVAS STUDIO -->
  <div id="editorModal" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-md hidden flex flex-col items-center justify-center p-2 sm:p-4 select-none">
    <div class="max-w-7xl w-full h-full max-h-[96vh] bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
      
      <!-- Studio Header -->
      <div class="px-5 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between text-xs shrink-0">
        <div class="flex items-center gap-3">
          <span class="w-8 h-8 rounded-lg bg-indigo-600/30 text-indigo-300 flex items-center justify-center font-bold text-sm border border-indigo-500/30">📐</span>
          <div>
            <h2 id="edFilename" class="font-mono font-semibold text-white text-sm">PXL_...</h2>
            <p class="text-[11px] text-zinc-400">Lightroom-style Horizon Leveler · Auto-insets safe crop with zero black corners</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="closeEditor()" class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition">
            Close ✕
          </button>
        </div>
      </div>

      <!-- Studio Body -->
      <div class="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        
        <!-- Center Canvas Viewport -->
        <div id="canvasViewport" class="flex-1 bg-zinc-950 flex items-center justify-center relative p-3 overflow-hidden cursor-crosshair">
          <canvas id="studioCanvas" class="max-h-[76vh] max-w-full shadow-2xl rounded border border-zinc-800/80"></canvas>
          
          <div id="drawHorizonHint" class="hidden absolute top-4 bg-indigo-600 text-white font-medium text-xs px-4 py-2 rounded-full shadow-xl pointer-events-none flex items-center gap-2 border border-indigo-400">
            <span>📏</span> Click and drag a line directly along the tilted shoreline / horizon
          </div>
        </div>

        <!-- Right Controls Panel -->
        <div class="w-full lg:w-96 bg-zinc-900 p-5 border-t lg:border-t-0 lg:border-l border-zinc-800 overflow-y-auto custom-scrollbar flex flex-col gap-4 text-xs shrink-0">
          
          <!-- Horizon Straightener -->
          <div class="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">Level Horizon</span>
              <span id="edAngleBadge" class="font-mono font-bold text-indigo-400 text-xs px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">0.0°</span>
            </div>

            <!-- Draw line tool button -->
            <button id="drawHorizonBtn" onclick="toggleDrawHorizonMode()" class="w-full py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-indigo-500/40 text-indigo-300 font-medium text-xs transition flex items-center justify-center gap-2">
              <span id="drawHorizonIcon">📏</span> <span id="drawHorizonText">Draw Horizon Line (Auto-Level)</span>
            </button>

            <!-- Angle slider -->
            <div class="space-y-1">
              <input type="range" id="edRotateSlider" min="-12" max="12" step="0.1" value="0" class="w-full accent-indigo-500 cursor-pointer">
              <div class="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>-12°</span>
                <span>0°</span>
                <span>+12°</span>
              </div>
            </div>

            <!-- Fine Nudge Buttons -->
            <div class="grid grid-cols-5 gap-1.5 text-center font-mono text-[11px]">
              <button onclick="nudgeRotate(-1.0)" class="py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300">-1.0°</button>
              <button onclick="nudgeRotate(-0.1)" class="py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300">-0.1°</button>
              <button onclick="resetRotate()" class="py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold">0.0°</button>
              <button onclick="nudgeRotate(0.1)" class="py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300">+0.1°</button>
              <button onclick="nudgeRotate(1.0)" class="py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300">+1.0°</button>
            </div>

            <!-- Grid Overlay Toggle -->
            <div class="pt-1 flex items-center justify-between text-[11px] text-zinc-400">
              <span>Show Alignment Grid</span>
              <input type="checkbox" id="gridToggle" checked onchange="toggleGrid(this.checked)" class="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer">
            </div>
          </div>

          <!-- Safe Inset & Aspect Ratio -->
          <div class="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">Crop & Framing</span>
              <span id="edCropDimsBadge" class="font-mono text-zinc-400 text-[10px]">-- × -- px</span>
            </div>

            <div class="grid grid-cols-4 gap-1.5 text-center text-[11px]">
              <button onclick="setCropPreset('safe_max', this)" class="crop-preset-btn active py-1 rounded bg-indigo-600/30 text-indigo-300 border border-indigo-500/40">Safe Max</button>
              <button onclick="setCropPreset('16:9', this)" class="crop-preset-btn py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400">16:9</button>
              <button onclick="setCropPreset('4:3', this)" class="crop-preset-btn py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400">4:3</button>
              <button onclick="setCropPreset('1:1', this)" class="crop-preset-btn py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400">1:1</button>
            </div>

            <!-- Manual Trimmers inside safe box -->
            <div class="space-y-2 pt-1 text-[11px] text-zinc-400">
              <div class="flex items-center justify-between text-zinc-300 font-medium pb-1 border-b border-zinc-800/80">
                <span>Trimming Inset</span>
                <button type="button" onclick="resetAllTrims()" class="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono">Reset Trims</button>
              </div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span>Trim Top: <span id="trimTopVal" class="text-indigo-400 font-mono">0%</span></span>
                  </div>
                  <input type="range" id="trimTopSlider" min="0" max="40" value="0" step="1" oninput="setTrim('top', this.value)" class="w-full accent-indigo-500 cursor-pointer">
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span>Trim Bottom: <span id="trimBottomVal" class="text-indigo-400 font-mono">0%</span></span>
                  </div>
                  <input type="range" id="trimBottomSlider" min="0" max="40" value="0" step="1" oninput="setTrim('bottom', this.value)" class="w-full accent-indigo-500 cursor-pointer">
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span>Trim Left: <span id="trimLeftVal" class="text-indigo-400 font-mono">0%</span></span>
                  </div>
                  <input type="range" id="trimLeftSlider" min="0" max="40" value="0" step="1" oninput="setTrim('left', this.value)" class="w-full accent-indigo-500 cursor-pointer">
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span>Trim Right: <span id="trimRightVal" class="text-indigo-400 font-mono">0%</span></span>
                  </div>
                  <input type="range" id="trimRightSlider" min="0" max="40" value="0" step="1" oninput="setTrim('right', this.value)" class="w-full accent-indigo-500 cursor-pointer">
                </div>
              </div>
            </div>
          </div>

          <!-- Staging & Actions -->
          <div class="space-y-2 pt-1">
            <button id="edSaveStagingBtn" onclick="saveToStaging()" class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2">
              <span>💾 Save Edit to Staging (.user_edits/)</span>
            </button>
            
            <div id="stagedSuccessBanner" class="hidden p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex flex-col gap-2.5">
              <div class="flex items-center justify-between font-semibold">
                <span>✓ Staged at Full Resolution!</span>
                <span id="stagedDimsText" class="font-mono text-[11px] text-emerald-400"></span>
              </div>
              
              <div class="flex items-center gap-2 pt-1">
                <button id="edRunRescoreBtn" onclick="runAiRescore()" class="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow">
                  <span id="rescoreBtnSpinner" class="hidden animate-spin">⏳</span>
                  <span id="rescoreBtnText">✨ Test AI Score</span>
                </button>
                <button id="edPromoteBtn" onclick="promoteToLibrary()" class="py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs border border-zinc-700 transition font-medium" title="Apply to active library">
                  Promote
                </button>
              </div>
            </div>

            <!-- AI Rescore Results Box -->
            <div id="edRescoreBox" class="hidden p-3.5 rounded-xl bg-zinc-950 border border-indigo-500/40 space-y-2 text-xs">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-zinc-200">AI Score & Critique</span>
                <span id="edNewScoreBadge" class="font-mono font-bold text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">--/25</span>
              </div>
              
              <div id="edScoreDiffRow" class="text-[11px] text-zinc-400 font-mono"></div>
              <p id="edCritiqueText" class="text-zinc-300 text-[11px] leading-relaxed bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/60"></p>
            </div>
          </div>

        </div>

      </div>

    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <div id="toast" class="fixed top-5 right-5 z-50 bg-indigo-600 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-medium hidden flex items-center gap-2 border border-indigo-400/40 toast-anim">
    <span>✓</span> <span id="toastMsg">Copied!</span>
  </div>

  <script>
    let allPhotos = [];
    let filteredPhotos = [];
    let currentFilter = 'all';
    let currentSort = 'score_desc';
    let searchQuery = '';
    let isCompact = false;
    let currentPage = 1;
    const PAGE_SIZE = 60;

    let copyQueue = new Set(JSON.parse(localStorage.getItem('photo_copy_queue') || '[]'));

    let imageVersionTimestamp = Date.now();

    async function init() {
      try {
        imageVersionTimestamp = Date.now();
        const res = await fetch(\`/api/photos?t=\${imageVersionTimestamp}\`);
        allPhotos = await res.json();
        allPhotos.forEach(p => { p.imgVer = imageVersionTimestamp; });
        
        document.getElementById('totalCountBadge').textContent = \`\${allPhotos.length} total\`;
        document.getElementById('cntTop82').textContent = allPhotos.filter(p => p.top82Rank).length;
        document.getElementById('cntQ45').textContent = allPhotos.filter(p => p.quality >= 4).length;
        document.getElementById('cntEdited').textContent = allPhotos.filter(p => p.isEdited).length;
        document.getElementById('cntTies').textContent = allPhotos.filter(p => p.flaggedForReview).length;

        applyFilters();
        renderQueueTray();
      } catch (err) {
        console.error('Failed to load photos:', err);
      }
    }

    function applyFilters() {
      filteredPhotos = allPhotos.filter(p => {
        if (currentFilter === 'top82' && !p.top82Rank) return false;
        if (currentFilter === 'q45' && p.quality < 4) return false;
        if (currentFilter === 'edited' && !p.isEdited) return false;
        if (currentFilter === 'ties' && !p.flaggedForReview) return false;
        if (currentFilter === 'tilted' && !p.issues.includes('tilted horizon')) return false;
        if (currentFilter === 'crop_issue' && !p.issues.includes('awkward crop or edge intrusion')) return false;

        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchFile = p.file.toLowerCase().includes(q);
          const matchCrit = p.critique.toLowerCase().includes(q);
          const matchCap = p.caption.toLowerCase().includes(q);
          const matchIssues = p.issues.some(i => i.toLowerCase().includes(q));
          if (!matchFile && !matchCrit && !matchCap && !matchIssues) return false;
        }

        return true;
      });

      filteredPhotos.sort((a, b) => {
        if (currentSort === 'top82_rank') {
          if (a.top82Rank && b.top82Rank) return a.top82Rank - b.top82Rank;
          if (a.top82Rank) return -1;
          if (b.top82Rank) return 1;
          return (b.totalScore - a.totalScore) || (b.quality - a.quality);
        }
        if (currentSort === 'score_desc') return (b.totalScore - a.totalScore) || (b.quality - a.quality);
        if (currentSort === 'score_asc') return (a.totalScore - b.totalScore) || (a.quality - b.quality);
        if (currentSort === 'quality_desc') return (b.quality - a.quality) || (b.totalScore - a.totalScore);
        if (currentSort === 'craft_desc') return ((b.scores?.craft || 0) - (a.scores?.craft || 0)) || (b.totalScore - a.totalScore);
        if (currentSort === 'time_asc') return (a.time || '').localeCompare(b.time || '');
        if (currentSort === 'time_desc') return (b.time || '').localeCompare(a.time || '');
        if (currentSort === 'file_asc') return a.file.localeCompare(b.file);
        return 0;
      });

      currentPage = 1;
      document.getElementById('filteredCountText').textContent = \`Showing \${filteredPhotos.length} photos\`;
      renderGrid();
    }

    function renderGrid() {
      const container = document.getElementById('photosContainer');
      const noResults = document.getElementById('noResults');

      if (filteredPhotos.length === 0) {
        container.innerHTML = '';
        noResults.classList.remove('hidden');
        renderPagination(0);
        return;
      }
      noResults.classList.add('hidden');

      const start = (currentPage - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const pageItems = filteredPhotos.slice(start, end);

      container.className = isCompact 
        ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5";

      container.innerHTML = pageItems.map(p => {
        const inQueue = copyQueue.has(p.file);
        const scoreColor = p.totalScore >= 19 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : p.totalScore >= 16 ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40';
        const qColor = p.quality >= 4 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-zinc-800 text-zinc-400 border-zinc-700';

        if (isCompact) {
          return \`
            <div class="group bg-zinc-900 border \${inQueue ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-800 hover:border-zinc-700'} rounded-lg overflow-hidden flex flex-col transition shadow">
              <div class="relative aspect-[4/3] bg-zinc-950 overflow-hidden cursor-pointer" onclick="openLightbox('\${p.file}')">
                <img src="/api/thumb/\${encodeURIComponent(p.file)}?v=\${p.imgVer || ''}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
                <div class="absolute top-1.5 left-1.5 flex items-center gap-1">
                  \${p.top82Rank ? \`<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-500/50 font-mono shadow">#\${p.top82Rank}</span>\` : ''}
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border \${scoreColor} font-mono">\${p.totalScore}</span>
                  <span class="text-[10px] font-bold px-1 py-0.5 rounded border \${qColor}">★\${p.quality}</span>
                </div>
              </div>
              <div class="p-2 flex items-center justify-between text-[11px] bg-zinc-900/90">
                <button onclick="copyToClipboard('\${p.file}')" title="Click to copy filename" class="font-mono text-zinc-300 hover:text-indigo-400 truncate text-left font-medium">
                  \${p.file.replace('PXL_2026', '..')}
                </button>
                <input type="checkbox" onchange="toggleQueue('\${p.file}')" \${inQueue ? 'checked' : ''} class="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer ml-1.5">
              </div>
            </div>
          \`;
        }

        return \`
          <div class="group bg-zinc-900/90 border \${inQueue ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-zinc-800/80 hover:border-zinc-700'} rounded-xl overflow-hidden flex flex-col transition duration-200 shadow-md hover:shadow-xl">
            <div class="relative aspect-[4/3] bg-zinc-950 overflow-hidden cursor-pointer" onclick="openLightbox('\${p.file}')">
              <img src="/api/thumb/\${encodeURIComponent(p.file)}?v=\${p.imgVer || ''}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" alt="\${p.caption}">
              
              <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                \${p.top82Rank ? \`<span class="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-500/25 text-amber-300 border border-amber-500/60 font-mono shadow">#\${p.top82Rank}</span>\` : ''}
                <span class="text-xs font-bold px-2 py-0.5 rounded-md border shadow \${scoreColor} font-mono">\${p.totalScore}/25</span>
                <span class="text-xs font-bold px-1.5 py-0.5 rounded-md border shadow \${qColor}">★\${p.quality}</span>
                \${p.isEdited ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">EDITED</span>' : ''}
                \${p.flaggedForReview ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40">TIED</span>' : ''}
                \${p.hasUserEdit ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/40">STAGED</span>' : ''}
              </div>

              <button 
                onclick="event.stopPropagation(); toggleQueue('\${p.file}')" 
                class="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg \${inQueue ? 'bg-indigo-600 text-white' : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300'} backdrop-blur border border-zinc-700 flex items-center justify-center transition shadow"
                title="\${inQueue ? 'Remove from queue' : 'Add to queue'}"
              >
                \${inQueue ? '✓' : '+'}
              </button>
            </div>

            <div class="p-3.5 flex flex-col flex-1 justify-between gap-2.5">
              <div>
                <div class="flex items-center justify-between gap-1">
                  <button 
                    onclick="copyToClipboard('\${p.file}')" 
                    title="Click to copy exact filename"
                    class="font-mono text-xs font-semibold text-zinc-200 hover:text-indigo-400 transition truncate text-left flex items-center gap-1 group/btn"
                  >
                    <span>\${p.file}</span>
                    <span class="opacity-0 group-hover/btn:opacity-100 text-[10px] text-indigo-400 font-sans">📋</span>
                  </button>
                  <span class="text-[10px] text-zinc-500 font-mono">\${p.width}x\${p.height}</span>
                </div>

                <div class="grid grid-cols-5 gap-1 text-center font-mono text-[10px] mt-2 bg-zinc-950 p-1.5 rounded-lg border border-zinc-800/60 text-zinc-400">
                  <div title="Intent">I:<span class="text-zinc-200 font-bold">\${p.scores?.intent || 0}</span></div>
                  <div title="Composition">C:<span class="text-zinc-200 font-bold">\${p.scores?.composition || 0}</span></div>
                  <div title="Light">L:<span class="text-zinc-200 font-bold">\${p.scores?.light || 0}</span></div>
                  <div title="Moment">M:<span class="text-zinc-200 font-bold">\${p.scores?.moment || 0}</span></div>
                  <div title="Craft">Cr:<span class="text-zinc-200 font-bold">\${p.scores?.craft || 0}</span></div>
                </div>

                \${p.issues.length ? \`
                  <div class="flex flex-wrap gap-1 mt-2">
                    \${p.issues.map(iss => \`
                      <span class="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-900/40">
                        \${iss}
                      </span>
                    \`).join('')}
                  </div>
                \` : ''}

                <p class="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed" title="\${p.critique}">
                  \${p.critique}
                </p>
              </div>

              <div class="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500">
                <span>\${p.time ? p.time.split('T')[0] : p.day}</span>
                <div class="flex items-center gap-2">
                  <button onclick="openEditor('\${p.file}')" class="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-0.5">
                    <span>📐 Level</span>
                  </button>
                  <button onclick="openLightbox('\${p.file}')" class="text-indigo-400 hover:text-indigo-300 font-medium">Inspect →</button>
                </div>
              </div>
            </div>
          </div>
        \`;
      }).join('');

      renderPagination(filteredPhotos.length);
    }

    function renderPagination(total) {
      const bar = document.getElementById('paginationBar');
      const topPag = document.getElementById('topPagination');
      
      if (total <= PAGE_SIZE) {
        bar.classList.add('hidden');
        if (topPag) topPag.classList.add('hidden');
        return;
      }
      bar.classList.remove('hidden');
      if (topPag) topPag.classList.remove('hidden');

      const totalPages = Math.ceil(total / PAGE_SIZE);
      const statsStr = \`Page \${currentPage} / \${totalPages}\`;
      document.getElementById('pageStats').textContent = \`Showing \${(currentPage-1)*PAGE_SIZE + 1}–\${Math.min(currentPage*PAGE_SIZE, total)} of \${total} photos (\${statsStr})\`;
      const topStatsEl = document.getElementById('topPageStats');
      if (topStatsEl) topStatsEl.textContent = \`\${currentPage} / \${totalPages}\`;
      
      const prevBtn = document.getElementById('prevPageBtn');
      const nextBtn = document.getElementById('nextPageBtn');
      const topPrevBtn = document.getElementById('topPrevBtn');
      const topNextBtn = document.getElementById('topNextBtn');

      const isFirst = currentPage === 1;
      const isLast = currentPage === totalPages;

      prevBtn.disabled = isFirst;
      if (topPrevBtn) topPrevBtn.disabled = isFirst;
      nextBtn.disabled = isLast;
      if (topNextBtn) topNextBtn.disabled = isLast;

      const goPrev = () => { if (currentPage > 1) { currentPage--; renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
      const goNext = () => { if (currentPage < totalPages) { currentPage++; renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); } };

      prevBtn.onclick = goPrev;
      if (topPrevBtn) topPrevBtn.onclick = goPrev;
      nextBtn.onclick = goNext;
      if (topNextBtn) topNextBtn.onclick = goNext;

      const pageNums = document.getElementById('pageNumbers');
      pageNums.innerHTML = \`<span class="px-2 py-1 font-mono text-zinc-300 font-medium">\${statsStr}</span>\`;
    }

    let isTrayMinimized = false;
    document.getElementById('toggleTrayBtn').onclick = () => {
      isTrayMinimized = !isTrayMinimized;
      const content = document.getElementById('trayContent');
      const icon = document.getElementById('toggleTrayIcon');
      const text = document.getElementById('toggleTrayText');

      if (isTrayMinimized) {
        content.classList.add('hidden');
        icon.textContent = '▲';
        text.textContent = 'Expand';
      } else {
        content.classList.remove('hidden');
        icon.textContent = '▼';
        text.textContent = 'Minimize';
      }
    };

    function toggleQueue(filename) {
      if (copyQueue.has(filename)) {
        copyQueue.delete(filename);
      } else {
        copyQueue.add(filename);
        showToast(\`Added \${filename} to queue\`);
      }
      localStorage.setItem('photo_copy_queue', JSON.stringify([...copyQueue]));
      renderGrid();
      renderQueueTray();
    }

    function renderQueueTray() {
      const count = copyQueue.size;
      const countEl = document.getElementById('queueCount');
      const chipsEl = document.getElementById('queueChips');
      
      countEl.textContent = \`\${count} selected\`;

      if (count === 0) {
        chipsEl.innerHTML = '<span class="text-zinc-600 italic">No photos in queue</span>';
        return;
      }

      chipsEl.innerHTML = [...copyQueue].map(file => \`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/80 font-mono text-[11px] shrink-0">
          \${file}
          <button onclick="toggleQueue('\${file}')" class="text-zinc-500 hover:text-red-400 font-bold ml-0.5">✕</button>
        </span>
      \`).join('');
    }

    async function copyToClipboard(text, msg = 'Copied to clipboard!') {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    }

    document.getElementById('copySpaceBtn').onclick = () => {
      if (copyQueue.size === 0) return showToast('Queue is empty');
      const text = [...copyQueue].join(' ');
      copyToClipboard(text, \`Copied \${copyQueue.size} filenames!\`);
    };

    document.getElementById('copyMarkdownBtn').onclick = () => {
      if (copyQueue.size === 0) return showToast('Queue is empty');
      const list = [...copyQueue].map(file => {
        const p = allPhotos.find(x => x.file === file);
        if (!p) return \`- \`\`\${file}\`\`\`;
        return \`- \`\`\${file}\`\` (Score: \${p.totalScore}/25, Q\${p.quality}, Cr:\${p.scores?.craft || 0}): \${p.caption || p.critique.slice(0, 80)}...\`;
      }).join('\\n');
      copyToClipboard(list, \`Copied Markdown list of \${copyQueue.size} photos!\`);
    };

    document.getElementById('clearQueueBtn').onclick = () => {
      copyQueue.clear();
      localStorage.removeItem('photo_copy_queue');
      renderGrid();
      renderQueueTray();
      showToast('Queue cleared');
    };

    function showToast(msg) {
      const toast = document.getElementById('toast');
      document.getElementById('toastMsg').textContent = msg;
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2200);
    }

    // Lightbox
    let currentLightboxFile = null;
    let currentLightboxIndex = -1;

    function openLightbox(filename) {
      const list = filteredPhotos.length ? filteredPhotos : allPhotos;
      const idx = list.findIndex(x => x.file === filename);
      if (idx === -1) return;
      currentLightboxIndex = idx;
      renderLightboxItem(list[idx], list.length, idx);
      document.getElementById('lightbox').classList.remove('hidden');
    }

    function navigateLightbox(step) {
      const list = filteredPhotos.length ? filteredPhotos : allPhotos;
      if (!list.length) return;
      currentLightboxIndex = (currentLightboxIndex + step + list.length) % list.length;
      renderLightboxItem(list[currentLightboxIndex], list.length, currentLightboxIndex);
    }

    function renderLightboxItem(p, total, idx) {
      currentLightboxFile = p.file;
      document.getElementById('lbCounter').textContent = \`Photo \${idx + 1} of \${total}\`;
      document.getElementById('lightboxImg').src = \`/api/photo/\${encodeURIComponent(p.file)}?v=\${p.imgVer || ''}\`;
      document.getElementById('lbFilename').textContent = p.file;
      document.getElementById('lbCaption').textContent = p.caption || '';
      document.getElementById('lbScoreBadge').textContent = \`\${p.totalScore}/25\`;
      document.getElementById('lbQualityBadge').textContent = \`★ \${p.quality}\`;
      
      document.getElementById('lbScoreI').textContent = p.scores?.intent || 0;
      document.getElementById('lbScoreC').textContent = p.scores?.composition || 0;
      document.getElementById('lbScoreL').textContent = p.scores?.light || 0;
      document.getElementById('lbScoreM').textContent = p.scores?.moment || 0;
      document.getElementById('lbScoreCr').textContent = p.scores?.craft || 0;

      const issuesEl = document.getElementById('lbIssuesContainer');
      issuesEl.innerHTML = p.issues.map(iss => \`
        <span class="text-[10px] px-2 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-900/50 font-medium">
          \${iss}
        </span>
      \`).join('');

      const strengthsEl = document.getElementById('lbStrengthsContainer');
      strengthsEl.innerHTML = (p.strengths || []).map(str => \`
        <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-900/50 font-medium">
          \${str}
        </span>
      \`).join('');

      document.getElementById('lbCritique').textContent = p.critique;
      document.getElementById('lbDims').textContent = \`\${p.width} x \${p.height} (\${p.aspect})\`;
      document.getElementById('lbTime').textContent = p.time || p.day;

      // Populate Story & Caption editor
      document.getElementById('lbDayLabelBadge').textContent = p.dayLabel || (p.day || 'Day');
      document.getElementById('lbDayTitleDisplay').textContent = p.dayTitle ? \`\${p.dayTitle}\${p.dayStats ? ' · ' + p.dayStats : ''}\` : '';
      document.getElementById('lbDayStoryInput').value = p.dayStory || '';
      document.getElementById('lbCaptionInput').value = p.caption || '';
      document.getElementById('lbIncludeCheck').checked = !p.isExcluded;

      const editRow = document.getElementById('lbEditRow');
      if (p.isEdited) {
        editRow.classList.remove('hidden');
        document.getElementById('lbEditStatus').textContent = p.flaggedForReview ? 'Kept Tie (Craft Fixed)' : 'Promoted Edit';
      } else {
        editRow.classList.add('hidden');
      }

      const diffBtn = document.getElementById('lightboxDiffBtn');
      if (p.hasOriginal) {
        diffBtn.classList.remove('hidden');
        diffBtn.onmousedown = () => { document.getElementById('lightboxImg').src = \`/api/original/\${encodeURIComponent(p.file)}?t=\${Date.now()}\`; };
        diffBtn.onmouseup = () => { document.getElementById('lightboxImg').src = \`/api/photo/\${encodeURIComponent(p.file)}?v=\${p.imgVer || Date.now()}\`; };
        diffBtn.onmouseleave = () => { document.getElementById('lightboxImg').src = \`/api/photo/\${encodeURIComponent(p.file)}?v=\${p.imgVer || Date.now()}\`; };
      } else {
        diffBtn.classList.add('hidden');
      }

      const qBtn = document.getElementById('lbQueueBtn');
      const inQ = copyQueue.has(p.file);
      qBtn.textContent = inQ ? '✓ Remove from Copy Queue' : '+ Add to Copy Queue';
      qBtn.onclick = () => {
        toggleQueue(p.file);
        qBtn.textContent = copyQueue.has(p.file) ? '✓ Remove from Copy Queue' : '+ Add to Copy Queue';
      };
    }

    document.getElementById('lbArrowPrev').onclick = () => navigateLightbox(-1);
    document.getElementById('lbArrowNext').onclick = () => navigateLightbox(1);
    document.getElementById('lbBtnPrev').onclick = () => navigateLightbox(-1);
    document.getElementById('lbBtnNext').onclick = () => navigateLightbox(1);

    async function saveStoryFromLightbox() {
      const p = allPhotos.find(x => x.file === currentLightboxFile);
      if (!p) return;

      const dayStory = document.getElementById('lbDayStoryInput').value.trim();
      const caption = document.getElementById('lbCaptionInput').value.trim();
      const includeInGallery = document.getElementById('lbIncludeCheck').checked;

      const btn = document.getElementById('lbSaveStoryBtn');
      const origText = btn.innerHTML;
      btn.innerHTML = '<span>⏳</span> Saving...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/save-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file: p.file,
            caption,
            dayStory,
            includeInGallery
          })
        });

        const data = await res.json();
        if (data.success) {
          p.caption = caption;
          p.dayStory = dayStory;
          p.isExcluded = !includeInGallery;
          document.getElementById('lbCaption').textContent = caption;

          // Sync other photos in the catalog on the same day
          if (p.dayLabel) {
            allPhotos.forEach(other => {
              if (other.dayLabel === p.dayLabel) {
                other.dayStory = dayStory;
              }
            });
          }

          showToast('✓ Story & caption saved to website!');
        } else {
          alert('Failed to save story: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Save error: ' + err.message);
      } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
      }
    }

    function closeLightbox() {
      document.getElementById('lightbox').classList.add('hidden');
      document.getElementById('lightboxImg').src = '';
    }

    // ==============================================================
    // LIGHTROOM / GOOGLE PHOTOS STYLE HORIZON LEVELER & SAFE INSET
    // ==============================================================
    let currentEditorFile = null;
    let editorImage = new Image();
    let originalMasterW = 0;
    let originalMasterH = 0;
    let currentAngle = 0;
    let showGrid = true;
    let isDrawingHorizon = false;
    let horizonStartPt = null;
    let trimTopPercent = 0;
    let trimBottomPercent = 0;
    let trimLeftPercent = 0;
    let trimRightPercent = 0;
    let currentPreset = 'safe_max';
    let currentLatestRescore = null;

    const canvas = document.getElementById('studioCanvas');
    const ctx = canvas.getContext('2d');

    function openEditor(filename) {
      const p = allPhotos.find(x => x.file === filename);
      if (!p) return;
      currentEditorFile = filename;
      currentAngle = 0;
      trimTopPercent = 0;
      trimBottomPercent = 0;
      trimLeftPercent = 0;
      trimRightPercent = 0;
      currentPreset = 'safe_max';
      currentLatestRescore = null;
      isDrawingHorizon = false;
      horizonStartPt = null;

      document.getElementById('edFilename').textContent = p.file;
      document.getElementById('edAngleBadge').textContent = '0.0°';
      document.getElementById('edRotateSlider').value = 0;
      document.getElementById('trimTopSlider').value = 0;
      document.getElementById('trimBottomSlider').value = 0;
      document.getElementById('trimLeftSlider').value = 0;
      document.getElementById('trimRightSlider').value = 0;
      document.getElementById('trimTopVal').textContent = '0%';
      document.getElementById('trimBottomVal').textContent = '0%';
      document.getElementById('trimLeftVal').textContent = '0%';
      document.getElementById('trimRightVal').textContent = '0%';
      document.getElementById('stagedSuccessBanner').classList.add('hidden');
      document.getElementById('edRescoreBox').classList.add('hidden');
      document.getElementById('drawHorizonHint').classList.add('hidden');
      document.getElementById('drawHorizonBtn').classList.remove('bg-indigo-600', 'text-white');
      document.getElementById('drawHorizonBtn').classList.add('bg-zinc-900', 'text-indigo-300');

      document.querySelectorAll('.crop-preset-btn').forEach(b => {
        b.classList.remove('active', 'bg-indigo-600/30', 'text-indigo-300', 'border-indigo-500/40');
        b.classList.add('bg-zinc-900', 'text-zinc-400', 'border-zinc-800');
      });
      document.querySelector('.crop-preset-btn[onclick*="safe_max"]').classList.add('active', 'bg-indigo-600/30', 'text-indigo-300', 'border-indigo-500/40');

      // Load master unedited backup if available so we always edit from pristine pixels
      const imgSrc = p.hasOriginal ? \`/api/original/\${encodeURIComponent(filename)}\` : \`/api/photo/\${encodeURIComponent(filename)}\`;

      editorImage = new Image();
      editorImage.crossOrigin = 'anonymous';
      editorImage.onload = () => {
        originalMasterW = editorImage.naturalWidth;
        originalMasterH = editorImage.naturalHeight;
        renderCanvas();
      };
      editorImage.src = imgSrc;

      closeLightbox();
      document.getElementById('editorModal').classList.remove('hidden');
    }

    function closeEditor() {
      document.getElementById('editorModal').classList.add('hidden');
    }

    // Core Canvas Rendering Engine
    function renderCanvas() {
      if (!editorImage.complete || !originalMasterW) return;

      const viewport = document.getElementById('canvasViewport');
      const maxDisplayW = Math.min(viewport.clientWidth - 40, 1200);
      const maxDisplayH = Math.min(viewport.clientHeight - 40, 750);

      const rad = Math.abs(currentAngle) * Math.PI / 180;
      const W = originalMasterW;
      const H = originalMasterH;

      // Mathematically optimal safe inscribed rectangle scale factor (Lightroom algorithm)
      const r = W / H;
      const safeScale = 1 / (Math.cos(rad) + Math.max(r, 1 / r) * Math.sin(rad));
      
      const safeW = Math.floor(safeScale * W);
      const safeH = Math.floor(safeScale * H);

      // Fit to canvas display dimensions
      const canvasScale = Math.min(maxDisplayW / W, maxDisplayH / H);
      const cW = Math.round(W * canvasScale);
      const cH = Math.round(H * canvasScale);

      canvas.width = cW;
      canvas.height = cH;

      ctx.clearRect(0, 0, cW, cH);

      // 1. Draw rotated image
      ctx.save();
      ctx.translate(cW / 2, cH / 2);
      ctx.rotate(currentAngle * Math.PI / 180);
      ctx.drawImage(editorImage, -cW / 2, -cH / 2, cW, cH);
      ctx.restore();

      // 2. Compute Crop Box in Canvas space
      const dispSafeW = safeW * canvasScale;
      const dispSafeH = safeH * canvasScale;

      let boxW = dispSafeW;
      let boxH = dispSafeH;

      // Handle preset aspect ratios
      if (currentPreset === '16:9') {
        const targetR = 16 / 9;
        if (boxW / boxH > targetR) {
          boxW = boxH * targetR;
        } else {
          boxH = boxW / targetR;
        }
      } else if (currentPreset === '4:3') {
        const targetR = 4 / 3;
        if (boxW / boxH > targetR) {
          boxW = boxH * targetR;
        } else {
          boxH = boxW / targetR;
        }
      } else if (currentPreset === '1:1') {
        const size = Math.min(boxW, boxH);
        boxW = size;
        boxH = size;
      }

      // Apply top, bottom, left, right trims
      const trimTopPx = (trimTopPercent / 100) * boxH;
      const trimBottomPx = (trimBottomPercent / 100) * boxH;
      const trimLeftPx = (trimLeftPercent / 100) * boxW;
      const trimRightPx = (trimRightPercent / 100) * boxW;

      const finalBoxW = Math.max(50, boxW - trimLeftPx - trimRightPx);
      const finalBoxH = Math.max(50, boxH - trimTopPx - trimBottomPx);

      const boxX = (cW - boxW) / 2 + trimLeftPx;
      const boxY = (cH - boxH) / 2 + trimTopPx;

      // 3. Darkened Vignette Mask outside the safe active crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      // Top
      ctx.fillRect(0, 0, cW, boxY);
      // Bottom
      ctx.fillRect(0, boxY + finalBoxH, cW, cH - (boxY + finalBoxH));
      // Left
      ctx.fillRect(0, boxY, boxX, finalBoxH);
      // Right
      ctx.fillRect(boxX + finalBoxW, boxY, cW - (boxX + finalBoxW), finalBoxH);

      // 4. Crop Frame Border
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, finalBoxW, finalBoxH);

      // Corner accent markers
      const cLen = 14;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      // Top-left
      ctx.beginPath(); ctx.moveTo(boxX, boxY + cLen); ctx.lineTo(boxX, boxY); ctx.lineTo(boxX + cLen, boxY); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(boxX + finalBoxW - cLen, boxY); ctx.lineTo(boxX + finalBoxW, boxY); ctx.lineTo(boxX + finalBoxW, boxY + cLen); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(boxX, boxY + finalBoxH - cLen); ctx.lineTo(boxX, boxY + finalBoxH); ctx.lineTo(boxX + cLen, boxY + finalBoxH); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(boxX + finalBoxW - cLen, boxY + finalBoxH); ctx.lineTo(boxX + finalBoxW, boxY + finalBoxH); ctx.lineTo(boxX + finalBoxW, boxY + finalBoxH - cLen); ctx.stroke();

      // 5. Alignment Grid Overlay
      if (showGrid) {
        // Rule of thirds (dashed white)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        const thirdX1 = boxX + finalBoxW / 3;
        const thirdX2 = boxX + (finalBoxW * 2) / 3;
        const thirdY1 = boxY + finalBoxH / 3;
        const thirdY2 = boxY + (finalBoxH * 2) / 3;

        ctx.beginPath();
        ctx.moveTo(thirdX1, boxY); ctx.lineTo(thirdX1, boxY + finalBoxH);
        ctx.moveTo(thirdX2, boxY); ctx.lineTo(thirdX2, boxY + finalBoxH);
        ctx.moveTo(boxX, thirdY1); ctx.lineTo(boxX + finalBoxW, thirdY1);
        ctx.moveTo(boxX, thirdY2); ctx.lineTo(boxX + finalBoxW, thirdY2);
        ctx.stroke();

        // Fine horizontal horizon level lines (golden tint)
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.3)';
        ctx.setLineDash([2, 4]);
        const numLines = 6;
        for (let i = 1; i < numLines; i++) {
          if (i === 2 || i === 4) continue; // skip overlapping thirds
          const ly = boxY + (finalBoxH * i) / numLines;
          ctx.beginPath();
          ctx.moveTo(boxX, ly);
          ctx.lineTo(boxX + finalBoxW, ly);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // 6. Draw Horizon interactive dragging guide line
      if (isDrawingHorizon && horizonStartPt && horizonCurrentPt) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(horizonStartPt.x, horizonStartPt.y);
        ctx.lineTo(horizonCurrentPt.x, horizonCurrentPt.y);
        ctx.stroke();

        // Draw start and end points
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(horizonStartPt.x, horizonStartPt.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(horizonCurrentPt.x, horizonCurrentPt.y, 4, 0, Math.PI * 2); ctx.fill();
      }

      // Update resolution badge in Master Pixel dimensions
      const masterScale = 1 / canvasScale;
      const masterCropW = Math.round(finalBoxW * masterScale);
      const masterCropH = Math.round(finalBoxH * masterScale);
      document.getElementById('edCropDimsBadge').textContent = \`\${masterCropW} × \${masterCropH} px\`;
    }

    // Straighten controls
    function setRotate(deg) {
      currentAngle = Math.round(deg * 10) / 10;
      document.getElementById('edRotateSlider').value = currentAngle;
      document.getElementById('edAngleBadge').textContent = \`\${currentAngle > 0 ? '+' : ''}\${currentAngle.toFixed(1)}°\`;
      renderCanvas();
    }

    function nudgeRotate(delta) {
      setRotate(currentAngle + delta);
    }

    function resetRotate() {
      setRotate(0);
    }

    document.getElementById('edRotateSlider').oninput = (e) => {
      setRotate(parseFloat(e.target.value));
    };

    function toggleGrid(enabled) {
      showGrid = enabled;
      renderCanvas();
    }

    function setCropPreset(preset, btn) {
      currentPreset = preset;
      document.querySelectorAll('.crop-preset-btn').forEach(b => {
        b.classList.remove('active', 'bg-indigo-600/30', 'text-indigo-300', 'border-indigo-500/40');
        b.classList.add('bg-zinc-900', 'text-zinc-400', 'border-zinc-800');
      });
      btn.classList.add('active', 'bg-indigo-600/30', 'text-indigo-300', 'border-indigo-500/40');
      btn.classList.remove('bg-zinc-900', 'text-zinc-400', 'border-zinc-800');
      renderCanvas();
    }

    function setTrim(type, val) {
      const p = parseInt(val, 10);
      if (type === 'top') {
        trimTopPercent = p;
        document.getElementById('trimTopVal').textContent = \`\${p}%\`;
      } else if (type === 'bottom') {
        trimBottomPercent = p;
        document.getElementById('trimBottomVal').textContent = \`\${p}%\`;
      } else if (type === 'left') {
        trimLeftPercent = p;
        document.getElementById('trimLeftVal').textContent = \`\${p}%\`;
      } else if (type === 'right') {
        trimRightPercent = p;
        document.getElementById('trimRightVal').textContent = \`\${p}%\`;
      }
      renderCanvas();
    }

    function resetAllTrims() {
      trimTopPercent = 0;
      trimBottomPercent = 0;
      trimLeftPercent = 0;
      trimRightPercent = 0;
      document.getElementById('trimTopSlider').value = 0;
      document.getElementById('trimBottomSlider').value = 0;
      document.getElementById('trimLeftSlider').value = 0;
      document.getElementById('trimRightSlider').value = 0;
      document.getElementById('trimTopVal').textContent = '0%';
      document.getElementById('trimBottomVal').textContent = '0%';
      document.getElementById('trimLeftVal').textContent = '0%';
      document.getElementById('trimRightVal').textContent = '0%';
      renderCanvas();
    }

    // "Draw Horizon Line" Tool
    let horizonCurrentPt = null;
    function toggleDrawHorizonMode() {
      isDrawingHorizon = !isDrawingHorizon;
      const btn = document.getElementById('drawHorizonBtn');
      const hint = document.getElementById('drawHorizonHint');
      const text = document.getElementById('drawHorizonText');

      if (isDrawingHorizon) {
        btn.classList.remove('bg-zinc-900', 'text-indigo-300');
        btn.classList.add('bg-indigo-600', 'text-white');
        hint.classList.remove('hidden');
        text.textContent = 'Click & Drag Line on Horizon...';
      } else {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('bg-zinc-900', 'text-indigo-300');
        hint.classList.add('hidden');
        text.textContent = 'Draw Horizon Line (Auto-Level)';
      }
    }

    canvas.addEventListener('mousedown', (e) => {
      if (!isDrawingHorizon) return;
      const rect = canvas.getBoundingClientRect();
      horizonStartPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      horizonCurrentPt = { ...horizonStartPt };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!isDrawingHorizon || !horizonStartPt) return;
      const rect = canvas.getBoundingClientRect();
      horizonCurrentPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      renderCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (!isDrawingHorizon || !horizonStartPt || !horizonCurrentPt) return;

      const dx = horizonCurrentPt.x - horizonStartPt.x;
      const dy = horizonCurrentPt.y - horizonStartPt.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 25) {
        // Calculate tilt angle of line in degrees
        // Positive dy means line goes down to the right -> camera tilted left -> need counter-clockwise (negative angle in Sharp)
        const angleRad = Math.atan2(dy, dx);
        const measuredDeg = -(angleRad * 180 / Math.PI);
        const newAngle = Math.round((currentAngle + measuredDeg) * 10) / 10;
        setRotate(newAngle);
        showToast(\`Leveled by \${newAngle > 0 ? '+' : ''}\${newAngle.toFixed(1)}°\`);
      }

      horizonStartPt = null;
      horizonCurrentPt = null;
      toggleDrawHorizonMode(); // exit mode
    });

    // Save to Staging
    async function saveToStaging() {
      if (!currentEditorFile || !originalMasterW) return;
      const saveBtn = document.getElementById('edSaveStagingBtn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>⏳ Processing High-Res Crop...</span>';

      const W = originalMasterW;
      const H = originalMasterH;
      const rad = Math.abs(currentAngle) * Math.PI / 180;
      const r = W / H;
      const safeScale = 1 / (Math.cos(rad) + Math.max(r, 1 / r) * Math.sin(rad));

      const safeW = Math.floor(safeScale * W);
      const safeH = Math.floor(safeScale * H);

      let boxW = safeW;
      let boxH = safeH;

      if (currentPreset === '16:9') {
        const targetR = 16 / 9;
        if (boxW / boxH > targetR) boxW = Math.floor(boxH * targetR);
        else boxH = Math.floor(boxW / targetR);
      } else if (currentPreset === '4:3') {
        const targetR = 4 / 3;
        if (boxW / boxH > targetR) boxW = Math.floor(boxH * targetR);
        else boxH = Math.floor(boxW / targetR);
      } else if (currentPreset === '1:1') {
        const size = Math.min(boxW, boxH);
        boxW = size;
        boxH = size;
      }

      const trimTopPx = Math.floor((trimTopPercent / 100) * boxH);
      const trimBottomPx = Math.floor((trimBottomPercent / 100) * boxH);
      const trimLeftPx = Math.floor((trimLeftPercent / 100) * boxW);
      const trimRightPx = Math.floor((trimRightPercent / 100) * boxW);

      const finalCropW = Math.max(100, boxW - trimLeftPx - trimRightPx);
      const finalCropH = Math.max(100, boxH - trimTopPx - trimBottomPx);

      // Calculate exact Sharp extract bounds
      // When Sharp rotates by currentAngle, the rotated image dimensions are:
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const rotW = Math.round(W * cosA + H * sinA);
      const rotH = Math.round(W * sinA + H * cosA);

      const baseLeft = Math.floor((rotW - safeW) / 2);
      const baseTop = Math.floor((rotH - safeH) / 2);

      const offsetX = Math.floor((safeW - boxW) / 2) + trimLeftPx;
      const offsetY = Math.floor((safeH - boxH) / 2) + trimTopPx;

      const cropLeft = Math.max(0, baseLeft + offsetX);
      const cropTop = Math.max(0, baseTop + offsetY);

      try {
        const res = await fetch('/api/save-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file: currentEditorFile,
            rotate: currentAngle,
            crop: {
              left: cropLeft,
              top: cropTop,
              width: finalCropW,
              height: finalCropH
            }
          })
        });

        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Failed to save');

        showToast(\`Saved \${currentEditorFile} to .user_edits/!\`);
        
        const banner = document.getElementById('stagedSuccessBanner');
        banner.classList.remove('hidden');
        document.getElementById('stagedDimsText').textContent = \`\${result.dims.width} × \${result.dims.height} px\`;

        const p = allPhotos.find(x => x.file === currentEditorFile);
        if (p) p.hasUserEdit = true;
        renderGrid();

      } catch (err) {
        console.error('Save error:', err);
        showToast('Error saving edit: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>💾 Save Edit to Staging (.user_edits/)</span>';
      }
    }

    // AI Rescore
    async function runAiRescore() {
      if (!currentEditorFile) return;
      const rescoreBtn = document.getElementById('edRunRescoreBtn');
      const spinner = document.getElementById('rescoreBtnSpinner');
      const text = document.getElementById('rescoreBtnText');

      rescoreBtn.disabled = true;
      spinner.classList.remove('hidden');
      text.textContent = 'Critiquing...';

      try {
        const res = await fetch('/api/rescore-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: currentEditorFile })
        });

        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Rescore failed');

        currentLatestRescore = result;

        const p = allPhotos.find(x => x.file === currentEditorFile);
        const oldSum = p ? p.totalScore : 0;
        const newSum = result.totalScore;
        const diff = newSum - oldSum;
        const diffStr = diff > 0 ? \`+\${diff} improvement!\` : diff === 0 ? 'Score tied' : \`\${diff} regression\`;

        const resBox = document.getElementById('edRescoreBox');
        resBox.classList.remove('hidden');
        document.getElementById('edNewScoreBadge').textContent = \`\${newSum}/25 (★\${result.quality})\`;
        document.getElementById('edScoreDiffRow').innerHTML = \`
          BEFORE: <span class="text-zinc-300 font-bold">\${oldSum}/25</span> → 
          AFTER: <span class="text-emerald-400 font-bold">\${newSum}/25</span> 
          <span class="\${diff > 0 ? 'text-emerald-400 font-bold' : diff === 0 ? 'text-indigo-400' : 'text-rose-400'}">(\${diffStr})</span>
        \`;
        document.getElementById('edCritiqueText').textContent = \`"\${result.critique}"\`;

        showToast(\`Critique complete: \${newSum}/25 (\${diffStr})\`);

      } catch (err) {
        console.error('Rescore error:', err);
        showToast('Rescore failed: ' + err.message);
      } finally {
        rescoreBtn.disabled = false;
        spinner.classList.add('hidden');
        text.textContent = '✨ Test AI Score';
      }
    }

    async function promoteToLibrary() {
      if (!currentEditorFile) return;
      if (!confirm(\`Promote staged edit for \${currentEditorFile} into the active library?\`)) return;

      try {
        const res = await fetch('/api/promote-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file: currentEditorFile,
            rescoreData: currentLatestRescore
          })
        });

        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Promote failed');

        showToast(\`Promoted \${currentEditorFile} to library!\`);
        closeEditor();
        init();
      } catch (err) {
        console.error('Promote error:', err);
        showToast('Promote failed: ' + err.message);
      }
    }

    window.addEventListener('keydown', e => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'textarea' || activeTag === 'input' || (document.activeElement && document.activeElement.isContentEditable);

      const ed = document.getElementById('editorModal');
      const lb = document.getElementById('lightbox');

      if (!ed.classList.contains('hidden')) {
        if (e.key === 'Escape') closeEditor();
        return;
      }

      if (!lb.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          if (isInput) {
            document.activeElement.blur();
          } else {
            closeLightbox();
          }
          return;
        }
        if (isInput) return; // Don't intercept arrow keys while editing text!
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.filter-btn').forEach(b => {
          b.classList.remove('active', 'border-indigo-500/60', 'bg-indigo-500/20', 'text-indigo-300');
          b.classList.add('border-zinc-800', 'bg-zinc-900/60', 'text-zinc-400');
        });
        btn.classList.add('active', 'border-indigo-500/60', 'bg-indigo-500/20', 'text-indigo-300');
        btn.classList.remove('border-zinc-800', 'bg-zinc-900/60', 'text-zinc-400');
        currentFilter = btn.dataset.filter;
        applyFilters();
      };
    });

    document.getElementById('searchInput').oninput = e => {
      searchQuery = e.target.value.trim();
      applyFilters();
    };

    document.getElementById('sortSelect').onchange = e => {
      currentSort = e.target.value;
      applyFilters();
    };

    document.getElementById('viewToggleBtn').onclick = () => {
      isCompact = !isCompact;
      document.getElementById('viewToggleText').textContent = isCompact ? 'Compact' : 'Detailed';
      document.getElementById('viewToggleIcon').textContent = isCompact ? '☰' : '⊞';
      renderGrid();
    };

    function resetFilters() {
      searchQuery = '';
      document.getElementById('searchInput').value = '';
      document.querySelector('.filter-btn[data-filter="all"]').click();
    }

    init();
  </script>
</body>
</html>`;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsed.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get all photos metadata
  if (pathname === '/api/photos') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cachedPhotos));
    return;
  }

  // API: Serve on-the-fly resized WebP thumbnail
  if (pathname.startsWith('/api/thumb/')) {
    const filename = pathname.replace('/api/thumb/', '');
    const thumbBuf = await getThumbnail(filename);
    if (!thumbBuf) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(thumbBuf);
    return;
  }

  // API: Serve full resolution photo
  if (pathname.startsWith('/api/photo/')) {
    const filename = pathname.replace('/api/photo/', '');
    const fullPath = path.join(TRIP_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  // API: Serve original photo backup if exists (.originals/)
  if (pathname.startsWith('/api/original/')) {
    const filename = pathname.replace('/api/original/', '');
    const origPath = path.join(ORIG_DIR, filename);
    if (!fs.existsSync(origPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Original Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    fs.createReadStream(origPath).pipe(res);
    return;
  }

  // API: Serve user staged edit (.user_edits/)
  if (pathname.startsWith('/api/user-edit/')) {
    const filename = pathname.replace('/api/user-edit/', '');
    const editPath = path.join(USER_EDITS_DIR, filename);
    if (!fs.existsSync(editPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Staged Edit Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(editPath).pipe(res);
    return;
  }

  // API: Save edit to staging (.user_edits/)
  if (pathname === '/api/save-edit' && req.method === 'POST') {
    try {
      const payload = await parseJsonBody(req);
      const { file, rotate, crop } = payload;
      if (!file || !crop) throw new Error('Missing file or crop bounds');

      const bakPath = path.join(ORIG_DIR, file);
      const srcPath = fs.existsSync(bakPath) ? bakPath : path.join(TRIP_DIR, file);
      if (!fs.existsSync(srcPath)) throw new Error('Source file not found: ' + file);

      const rawBuf = fs.readFileSync(srcPath);
      let pipe = sharp(rawBuf);

      if (rotate && Math.abs(rotate) > 0.01) {
        pipe = pipe.rotate(rotate);
      }

      pipe = pipe.extract({
        left: Math.round(crop.left),
        top: Math.round(crop.top),
        width: Math.round(crop.width),
        height: Math.round(crop.height),
      });

      const outBuf = await pipe.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      const targetPath = path.join(USER_EDITS_DIR, file);
      fs.writeFileSync(targetPath, outBuf);

      let logData = {};
      if (fs.existsSync(EDITS_LOG_PATH)) {
        try { logData = JSON.parse(fs.readFileSync(EDITS_LOG_PATH, 'utf8')); } catch {}
      }
      logData[file] = {
        file,
        rotate: rotate || 0,
        crop,
        dims: { width: Math.round(crop.width), height: Math.round(crop.height) },
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(EDITS_LOG_PATH, JSON.stringify(logData, null, 2) + '\n');

      console.log(`[Viewer] Saved staged edit: ${file} (${Math.round(crop.width)}x${Math.round(crop.height)})`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        file,
        dims: { width: Math.round(crop.width), height: Math.round(crop.height) }
      }));
      return;
    } catch (err) {
      console.error('[Viewer] /api/save-edit error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  // API: Live AI rescore of staged edit
  if (pathname === '/api/rescore-edit' && req.method === 'POST') {
    try {
      const payload = await parseJsonBody(req);
      const { file } = payload;
      const stagedPath = path.join(USER_EDITS_DIR, file);
      if (!fs.existsSync(stagedPath)) throw new Error('Staged edit not found in .user_edits/');

      if (!critiqueModule) throw new Error('Critique module not available');

      const { DEFAULT_MODEL, GENRES, ISSUES, STRENGTHS, SCORE_SYSTEM, SCORE_SCHEMA, gemini } = critiqueModule;
      const stagedBuf = fs.readFileSync(stagedPath);
      const critiqueBuf = await sharp(stagedBuf)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      console.log(`[Viewer] Requesting Gemini critique for staged ${file}...`);
      const apiRes = await gemini({
        apiKey,
        model: DEFAULT_MODEL,
        system: SCORE_SYSTEM,
        parts: [
          { text: 'Critique this photograph.' },
          { inline_data: { mime_type: 'image/jpeg', data: critiqueBuf.toString('base64') } },
        ],
        schema: SCORE_SCHEMA,
      });

      const clampGrade = (v) => (Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : undefined);
      const cleanStr = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

      const scores = {
        intent: clampGrade(apiRes?.intent) ?? 2,
        composition: clampGrade(apiRes?.composition) ?? 2,
        light: clampGrade(apiRes?.light) ?? 2,
        moment: clampGrade(apiRes?.moment) ?? 2,
        craft: clampGrade(apiRes?.craft) ?? 2,
      };

      const totalScore = (scores.intent || 0) + (scores.composition || 0) + (scores.light || 0) + (scores.moment || 0) + (scores.craft || 0);

      const rescoreData = {
        genre: GENRES.includes(apiRes?.genre) ? apiRes.genre : 'other',
        critique: cleanStr(apiRes?.critique, 900),
        scores,
        totalScore,
        issues: Array.isArray(apiRes?.issues) ? apiRes.issues.filter((x) => ISSUES.includes(x)) : [],
        strengths: Array.isArray(apiRes?.strengths) ? apiRes.strengths.filter((x) => STRENGTHS.includes(x)) : [],
        quality: clampGrade(apiRes?.quality) ?? 2,
        caption: cleanStr(apiRes?.caption, 140) || '',
        alt: cleanStr(apiRes?.alt, 180) || '',
      };

      console.log(`[Viewer] Critique complete for ${file}: Score ${totalScore}/25, Quality ${rescoreData.quality}/5`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...rescoreData }));
      return;
    } catch (err) {
      console.error('[Viewer] /api/rescore-edit error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  // API: Promote staged edit into main library
  if (pathname === '/api/promote-edit' && req.method === 'POST') {
    try {
      const payload = await parseJsonBody(req);
      const { file, rescoreData } = payload;
      const stagedPath = path.join(USER_EDITS_DIR, file);
      if (!fs.existsSync(stagedPath)) throw new Error('Staged edit not found in .user_edits/');

      const mainImgPath = path.join(TRIP_DIR, file);
      const bakPath = path.join(ORIG_DIR, file);

      if (!fs.existsSync(bakPath) && fs.existsSync(mainImgPath)) {
        fs.copyFileSync(mainImgPath, bakPath);
      }

      fs.copyFileSync(stagedPath, mainImgPath);

      const thumbPath = path.join(THUMB_CACHE_DIR, `${file}.webp`);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

      const cur = JSON.parse(fs.readFileSync(CURATION_PATH, 'utf8'));
      const entry = cur.photos.find(p => p.file === file);
      if (entry) {
        if (!entry.prevAi) {
          entry.prevAi = structuredClone(entry.ai);
        }
        if (rescoreData) {
          entry.ai = {
            genre: rescoreData.genre || entry.ai?.genre || 'other',
            critique: rescoreData.critique || entry.ai?.critique,
            scores: rescoreData.scores || entry.ai?.scores,
            issues: rescoreData.issues || entry.ai?.issues || [],
            strengths: rescoreData.strengths || entry.ai?.strengths || [],
            quality: rescoreData.quality || entry.ai?.quality || 3,
            caption: rescoreData.caption || entry.ai?.caption,
            alt: rescoreData.alt || entry.ai?.alt,
          };
        }
        const meta = await sharp(mainImgPath).metadata();
        entry.width = meta.width;
        entry.height = meta.height;
        entry.aspect = Number((meta.width / meta.height).toFixed(3));
        fs.writeFileSync(CURATION_PATH, JSON.stringify(cur, null, 2) + '\n');
      }

      cachedPhotos = loadCuration();
      console.log(`[Viewer] Successfully promoted ${file} to active library!`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, file }));
      return;
    } catch (err) {
      console.error('[Viewer] /api/promote-edit error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  // API: Save story and caption to trip JSON and curation
  if (pathname === '/api/save-story' && req.method === 'POST') {
    try {
      const payload = await parseJsonBody(req);
      const { file, caption, dayStory, includeInGallery } = payload;
      if (!file) throw new Error('Missing file parameter');

      const baseId = file.replace(/\.(jpg|jpeg|png)$/i, '');
      let trip = JSON.parse(fs.readFileSync(TRIP_JSON_PATH, 'utf8'));

      // 1. Update caption
      trip.captions = trip.captions || {};
      if (caption !== undefined) {
        trip.captions[baseId] = caption;
      }

      // 2. Find matching entry in trip.entries
      let matchedEntry = null;
      if (trip.entries) {
        matchedEntry = trip.entries.find(e => e.photos && e.photos.includes(baseId));
        if (!matchedEntry) {
          const curData = JSON.parse(fs.readFileSync(CURATION_PATH, 'utf8'));
          const pCur = curData.photos.find(p => p.file === file);
          if (pCur && pCur.day) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const parts = pCur.day.split('-');
            if (parts.length === 3) {
              const mIdx = parseInt(parts[1], 10) - 1;
              const dayNum = parseInt(parts[2], 10);
              const labelSub = `${months[mIdx]} ${dayNum}`;
              matchedEntry = trip.entries.find(e => e.label && e.label.includes(labelSub));
            }
          }
        }
      }

      // 3. Update dayStory in entry text
      if (matchedEntry && dayStory !== undefined) {
        matchedEntry.text = dayStory ? dayStory.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean) : [];
      }

      // 4. Update gallery inclusion
      if (includeInGallery !== undefined) {
        if (includeInGallery) {
          if (trip.exclude) {
            trip.exclude = trip.exclude.filter(id => id !== baseId);
          }
          if (matchedEntry) {
            matchedEntry.photos = matchedEntry.photos || [];
            if (!matchedEntry.photos.includes(baseId)) {
              matchedEntry.photos.push(baseId);
            }
          }
        } else {
          trip.exclude = trip.exclude || [];
          if (!trip.exclude.includes(baseId)) {
            trip.exclude.push(baseId);
          }
          if (matchedEntry && matchedEntry.photos) {
            matchedEntry.photos = matchedEntry.photos.filter(id => id !== baseId);
          }
        }
      }

      fs.writeFileSync(TRIP_JSON_PATH, JSON.stringify(trip, null, 2), 'utf8');

      // 5. Update curation.json with userStory and userCaption
      const cur = JSON.parse(fs.readFileSync(CURATION_PATH, 'utf8'));
      const curPhoto = cur.photos.find(p => p.file === file);
      if (curPhoto) {
        if (!curPhoto.ai) curPhoto.ai = {};
        if (caption) curPhoto.ai.caption = caption;
        curPhoto.userStory = dayStory;
        curPhoto.userCaption = caption;
        fs.writeFileSync(CURATION_PATH, JSON.stringify(cur, null, 2) + '\n');
      }

      cachedPhotos = loadCuration();
      console.log(`[Viewer] Saved story and caption for ${file} (base: ${baseId})`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        baseId,
        caption,
        dayStory,
        includeInGallery
      }));
      return;
    } catch (err) {
      console.error('[Viewer] /api/save-story error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  // Serve Main Explorer UI HTML
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtml());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Photo Curation & Straightener Studio is live!`);
  console.log(`👉 Open in your browser: http://localhost:${PORT}`);
  console.log(`   - Lightroom-style Horizon Leveler with Auto Safe Inset`);
  console.log(`   - Zero black corners guaranteed`);
  console.log(`   - Saves safely to .user_edits/`);
  console.log(`======================================================\n`);
});
