import manifest from './photos.generated.json';

/**
 * Where the processed images are served from.
 * Defaults to /photos (public/photos). To move to Cloudflare R2 later, set
 * VITE_PHOTO_BASE to the bucket's public URL at build time. No code changes needed.
 */
const PHOTO_BASE: string = import.meta.env.VITE_PHOTO_BASE ?? '/photos';

export interface Photo {
  /** Base file name (no extension, no size suffix). */
  file: string;
  width: number;
  height: number;
  widths: number[];
  caption?: string;
  /** Description for screen readers. Falls back to the caption. */
  alt?: string;
}

/** One chapter of the diary: some writing followed by its photos. */
export interface Section {
  /** Small mono line above the title, e.g. "Day 3 · Aug 14". */
  label?: string;
  title?: string;
  /** Paragraphs. */
  text: string[];
  /** `index` is the photo's position in Trip.photos (used by the lightbox). */
  photos: { photo: Photo; index: number }[];
}

export interface Trip {
  slug: string;
  title: string;
  location: string;
  /** Free-form, shown as-is, e.g. "Aug 2025". */
  date: string;
  blurb?: string;
  /** Base file name of the cover photo. Defaults to the first photo. */
  cover?: string;
  /** Every photo, in diary order. The lightbox steps through this list. */
  photos: Photo[];
  sections: Section[];
}

interface EntryMeta {
  /** e.g. "Day 3 · Aug 14" */
  label?: string;
  title?: string;
  /** One paragraph, or an array of paragraphs. */
  text?: string | string[];
  /** Base file names (no extension) shown under this entry, in order. */
  photos: string[];
}

/** Shape of a src/data/trips/<slug>.json file. See that folder's README. */
export interface TripMeta {
  title: string;
  location: string;
  /** Shown as-is, e.g. "Aug 2025". */
  date: string;
  /** ISO date (YYYY-MM-DD) used only to sort trips, newest first. */
  start?: string;
  /** Drafts are visible in `pnpm dev` but left out of production builds. */
  draft?: boolean;
  blurb?: string;
  cover?: string;
  /** Captions keyed by base file name. */
  captions?: Record<string, string>;
  /** Alt text keyed by base file name. */
  alt?: Record<string, string>;
  /** Base file names that are never processed or published. */
  exclude?: string[];
  /**
   * Optional photo diary. Photos not mentioned in any entry are appended in a
   * final "More" section, so nothing is dropped by accident. Leave this out
   * for a plain grid.
   */
  entries?: EntryMeta[];
}

type TripFile = TripMeta & { slug: string };

// One JSON file per trip. The file name is the slug and must match the folder
// name in photos-src/.
const tripFiles = import.meta.glob<TripMeta>('./trips/*.json', { eager: true, import: 'default' });

const tripMeta: TripFile[] = Object.entries(tripFiles)
  .map(([path, meta]) => ({ ...meta, slug: path.replace(/^.*\/(.+)\.json$/, '$1') }))
  .filter((meta) => import.meta.env.DEV || !meta.draft)
  .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? '') || a.slug.localeCompare(b.slug));

type Manifest = Record<string, Omit<Photo, 'caption' | 'alt'>[]>;

function buildTrip(meta: TripFile): Trip {
  const excluded = new Set(meta.exclude ?? []);
  const files = ((manifest as Manifest)[meta.slug] ?? []).filter((p) => !excluded.has(p.file));
  const byFile = new Map<string, Photo>(
    files.map((p) => [p.file, { ...p, caption: meta.captions?.[p.file], alt: meta.alt?.[p.file] }]),
  );

  const photos: Photo[] = [];
  const used = new Set<string>();

  /** Resolves file names to photos, skipping unknown or already-used ones. */
  const take = (names: string[]) =>
    names.flatMap((name) => {
      const photo = byFile.get(name);
      if (!photo) {
        if (import.meta.env.DEV && !excluded.has(name)) {
          console.warn(`[trips] ${meta.slug}: no photo named "${name}"`);
        }
        return [];
      }
      if (used.has(name)) return [];
      used.add(name);
      photos.push(photo);
      return [{ photo, index: photos.length - 1 }];
    });

  const sections: Section[] = (meta.entries ?? []).map((entry) => ({
    label: entry.label,
    title: entry.title,
    text: entry.text === undefined ? [] : [entry.text].flat(),
    photos: take(entry.photos),
  }));

  const rest = take(files.map((p) => p.file));
  if (rest.length > 0) {
    sections.push({ title: sections.length > 0 ? 'More' : undefined, text: [], photos: rest });
  }

  return {
    slug: meta.slug,
    title: meta.title,
    location: meta.location,
    date: meta.date,
    blurb: meta.blurb,
    cover: meta.cover,
    photos,
    sections,
  };
}

export const trips: Trip[] = tripMeta.map(buildTrip).filter((t) => t.photos.length > 0);

export function coverOf(trip: Trip): Photo {
  return trip.photos.find((p) => p.file === trip.cover) ?? trip.photos[0];
}

/** Text for screen readers: explicit alt text, else the caption, else a generic label. */
export function photoAlt(trip: Trip, photo: Photo, index: number): string {
  return photo.alt ?? photo.caption ?? `${trip.title}, photo ${index + 1}`;
}

export function photoSrc(trip: Trip, photo: Photo, width: number): string {
  return `${PHOTO_BASE}/${trip.slug}/${photo.file}-${width}.webp`;
}

export function photoSrcSet(trip: Trip, photo: Photo): string {
  return photo.widths.map((w) => `${photoSrc(trip, photo, w)} ${w}w`).join(', ');
}

/** Largest available size, used as the plain `src` fallback. */
export function photoFallback(trip: Trip, photo: Photo): string {
  return photoSrc(trip, photo, Math.max(...photo.widths));
}
