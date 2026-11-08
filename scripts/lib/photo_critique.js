// Shared by curate_photos.js (per-photo scoring) and rank_photos.js (side-by-side ranking),
// so both passes judge photos against the same rubric.

export const DEFAULT_MODEL = 'gemini-4-argon';
export const API_BASE = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com';

// USD per 1M tokens, used only for the cost estimate printed at the end of a run.
// Thinking tokens bill as output. Check the billing console for actual charges.
const PRICES = {
  'gemini-4-argon': { input: 2.0, output: 10.0 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
};

// ------------------------------------------------------------------ rubric

// Written for the model as plain instructions. Deliberately free of hype: the goal is an
// honest critique that uses the whole scale, not encouragement.
const CRITERIA = `These photographs come from one person's trip: a city marathon, days of city sightseeing, and several days of mountain hiking. They were shot on a phone, so do not expect shallow depth of field or long-lens compression.

Critique them the way an instructor would in a photography course. Judge the photograph, not the subject: a famous landmark or a beautiful place does not make a strong photograph on its own, and an ordinary scene can make a strong one if it is well seen.

Criteria:
1. Intent and point of view. Evidence of deliberate choices: vantage point, distance, framing, timing. A centered, eye-level record of what was in front of the photographer shows little intent.
2. Composition and visual hierarchy. A clear subject; the eye knows where to go first and where to go next; the subject separates from its background; every element in the frame earns its place.
3. Light. Whether the quality and direction of the light shape the subject, giving texture, depth or mood, or whether it is flat or harsh and works against it. Includes exposure: clipped highlights or crushed shadows that lose important detail.
4. Moment. For people, motion or changing weather: was the shutter pressed at a meaningful instant (gesture, expression, peak action, light breaking through)? For static scenes: does the photo convey a specific time and atmosphere rather than a generic view?
5. Craft and edges. Focus where it matters, enough sharpness for the subject, level horizons where they should be level, no accidental intrusions or awkward cuts at the edges of the frame.

What counts as a distraction depends on the photo. Crowds, barriers, race bibs and signage are part of a marathon photo. A stranger's backpack in the corner of a mountain view is not.

Judge selfies and photos of companions by the same standard. Most are records. One with real expression, good light and a setting that adds to it can score higher.

Be honest and specific. Most travel photos are competent records, and that is what a 3 means. Do not inflate scores to be encouraging, and do not mark a photo down for being simple when the simplicity is deliberate.`;

const SCALE = `Grades:
5: Exceptional. Would hold up in a portfolio review. Intent, composition and light work together, with no significant craft problem. Rare.
4: Strong. Clearly well seen, with one element short of exceptional.
3: Competent record. Shows the place or event clearly, but the photograph makes few deliberate choices.
2: Weak. A real problem undermines it: no clear subject, competing elements, poor light, missed focus, careless framing.
1: Failed. Accidental, badly blurred or unreadable.`;

const LABEL_RULES = `Captions and alt text must be literal. Never identify people or guess who anyone is. Name a place only if its name is legible in the image or it is a world-famous landmark you are certain of; never guess the names of mountains, lakes, trails or towns. Do not use words like stunning, breathtaking or majestic.`;

export const SCORE_SYSTEM = `${CRITERIA}\n\n${SCALE}\n\nWrite the critique before deciding any grade. The overall grade is a judgement, not an average: one serious flaw can cap it.\n\n${LABEL_RULES}`;

export const RANK_SYSTEM = `${CRITERIA}\n\nYou will be shown several photographs from this trip, each preceded by its number. Compare them with each other and order them from strongest to weakest as photographs, using the criteria above. Also identify any photos in the set that are redundant takes of the same subject or moment (burst shots or slight reframings where showing both on the same page would be repetitive), pairing each weaker redundant take with the stronger photo it duplicates. Compare the leading candidates before giving the order.`;

export const TITLE_SYSTEM = `You write short, plain titles for the days of a travel photo diary. ${LABEL_RULES}`;

// ---------------------------------------------------------------- schemas

export const GENRES = ['landscape', 'urban or architecture', 'street or people', 'event or sport', 'portrait or selfie', 'food or detail', 'other'];

export const ISSUES = [
  'no clear subject',
  'competing or cluttered elements',
  'flat or harsh light',
  'clipped highlights or crushed shadows',
  'missed focus or motion blur',
  'tilted horizon',
  'awkward crop or edge intrusion',
  'obstructed view',
  'passive record shot',
];

export const STRENGTHS = [
  'deliberate point of view',
  'clear visual hierarchy',
  'light shapes the subject',
  'decisive moment',
  'clean edges and negative space',
  'depth and layering',
  'strong sense of place',
  'expressive human moment',
];

const grade = (description) => ({ type: 'INTEGER', minimum: 1, maximum: 5, description });

export const SCORE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    genre: { type: 'STRING', enum: GENRES },
    critique: {
      type: 'STRING',
      description: '2 to 4 sentences on intent, composition, light, moment and craft as they apply. Refer to specific things in the frame.',
    },
    intent: grade('Intent and point of view, 1 to 5.'),
    composition: grade('Composition and visual hierarchy, 1 to 5.'),
    light: grade('Light and exposure, 1 to 5.'),
    moment: grade('Moment, 1 to 5.'),
    craft: grade('Craft and edges, 1 to 5.'),
    quality: grade('Overall grade, 1 to 5, using the grade definitions.'),
    issues: { type: 'ARRAY', items: { type: 'STRING', enum: ISSUES } },
    strengths: { type: 'ARRAY', items: { type: 'STRING', enum: STRENGTHS } },
    caption: { type: 'STRING', description: 'Plain caption, 10 words or fewer.' },
    alt: { type: 'STRING', description: 'What is visible, for a screen-reader user. Under 125 characters.' },
  },
  required: ['genre', 'critique', 'intent', 'composition', 'light', 'moment', 'craft', 'quality', 'issues', 'strengths', 'caption', 'alt'],
  propertyOrdering: ['genre', 'critique', 'intent', 'composition', 'light', 'moment', 'craft', 'quality', 'issues', 'strengths', 'caption', 'alt'],
};

export const RANK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    comparison: { type: 'STRING', description: '3 to 6 sentences comparing the strongest candidates and noting any redundant takes.' },
    ranking: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Every photo number exactly once, strongest first.' },
    duplicates: {
      type: 'ARRAY',
      description: 'Photos in this set that are redundant takes of a stronger photo in this set and should not both appear on the page.',
      items: {
        type: 'OBJECT',
        properties: {
          weaker: { type: 'INTEGER', description: 'Photo number of the redundant weaker take.' },
          stronger: { type: 'INTEGER', description: 'Photo number of the stronger take to keep.' },
        },
        required: ['weaker', 'stronger'],
      },
    },
  },
  required: ['comparison', 'ranking', 'duplicates'],
  propertyOrdering: ['comparison', 'ranking', 'duplicates'],
};

export const TITLE_SCHEMA = {
  type: 'OBJECT',
  properties: { title: { type: 'STRING', description: 'Plain title, 5 words or fewer, no puns.' } },
  required: ['title'],
};

// ------------------------------------------------------------------ client

export const usage = { calls: 0, input: 0, output: 0, thinking: 0, byModel: {} };

export function costEstimate() {
  let total = 0;
  for (const [model, u] of Object.entries(usage.byModel)) {
    const p = PRICES[model];
    if (p) total += (u.input * p.input + (u.output + u.thinking) * p.output) / 1e6;
  }
  return total;
}

export function usageSummary() {
  const cost = costEstimate();
  return (
    `${usage.calls} Gemini requests: ${usage.input.toLocaleString()} input, ` +
    `${usage.output.toLocaleString()} output, ${usage.thinking.toLocaleString()} thinking tokens` +
    (cost ? ` (about $${cost.toFixed(2)} at list price; check billing for the actual charge)` : '')
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One structured-output request. Returns parsed JSON, or null if the answer was blocked or unparseable. */
export async function gemini({ model, apiKey, system, parts, schema, temperature = 0.2, maxOutputTokens = 8192 }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature, maxOutputTokens },
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`${API_BASE}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      const fatal = res.status === 400 || res.status === 403 || res.status === 404;
      throw Object.assign(new Error(`Gemini API ${res.status}: ${detail}`), { fatal });
    }

    const data = await res.json();
    const u = data.usageMetadata ?? {};
    const m = (usage.byModel[model] ??= { input: 0, output: 0, thinking: 0 });
    usage.calls++;
    for (const [key, field] of [['input', 'promptTokenCount'], ['output', 'candidatesTokenCount'], ['thinking', 'thoughtsTokenCount']]) {
      usage[key] += u[field] ?? 0;
      m[key] += u[field] ?? 0;
    }

    const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
    if (!text) return null;
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return null;
    }
  }
  throw new Error('Gemini API kept returning 429/5xx; try again later.');
}
