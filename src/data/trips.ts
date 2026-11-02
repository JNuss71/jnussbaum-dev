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

interface TripMeta {
  /** Must match the folder name in photos-src/ */
  slug: string;
  title: string;
  location: string;
  date: string;
  blurb?: string;
  cover?: string;
  /** Optional captions keyed by base file name. */
  captions?: Record<string, string>;
  /**
   * Optional photo diary. Photos not mentioned in any entry are appended in a
   * final "More" section, so nothing is dropped by accident. Leave this out
   * for a plain grid.
   */
  entries?: EntryMeta[];
}

/**
 * Hand-edited trip details, newest first.
 * A trip only appears on the site once photos-src/<slug>/ has been processed
 * with `pnpm build:photos`. Example:
 *
 *   {
 *     slug: 'iceland',
 *     title: 'Iceland',
 *     location: 'Ring Road, Iceland',
 *     date: 'Aug 2025',
 *     blurb: 'Ten days around the Ring Road.',
 *     cover: 'DSC01234',
 *     captions: { DSC01234: 'Seljalandsfoss at 6am' },
 *     entries: [
 *       {
 *         label: 'Day 1 · Aug 3',
 *         title: 'Landing in Keflavík',
 *         text: ['First paragraph.', 'Second paragraph.'],
 *         photos: ['DSC01234', 'DSC01240'],
 *       },
 *     ],
 *   },
 */
const tripMeta: TripMeta[] = [];

type Manifest = Record<string, Omit<Photo, 'caption'>[]>;

function buildTrip(meta: TripMeta): Trip {
  const files = (manifest as Manifest)[meta.slug] ?? [];
  const byFile = new Map<string, Photo>(
    files.map((p) => [p.file, { ...p, caption: meta.captions?.[p.file] }]),
  );

  const photos: Photo[] = [];
  const used = new Set<string>();

  /** Resolves file names to photos, skipping unknown or already-used ones. */
  const take = (names: string[]) =>
    names.flatMap((name) => {
      const photo = byFile.get(name);
      if (!photo) {
        if (import.meta.env.DEV) console.warn(`[trips] ${meta.slug}: no photo named "${name}"`);
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
