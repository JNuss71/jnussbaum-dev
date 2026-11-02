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

export interface Trip {
  slug: string;
  title: string;
  location: string;
  /** Free-form, shown as-is, e.g. "Aug 2025". */
  date: string;
  blurb?: string;
  /** Base file name of the cover photo. Defaults to the first photo. */
  cover?: string;
  photos: Photo[];
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
 *   },
 */
const tripMeta: TripMeta[] = [];

type Manifest = Record<string, Omit<Photo, 'caption'>[]>;

export const trips: Trip[] = tripMeta
  .map((meta): Trip => {
    const files = (manifest as Manifest)[meta.slug] ?? [];
    return {
      slug: meta.slug,
      title: meta.title,
      location: meta.location,
      date: meta.date,
      blurb: meta.blurb,
      cover: meta.cover,
      photos: files.map((p) => ({ ...p, caption: meta.captions?.[p.file] })),
    };
  })
  .filter((t) => t.photos.length > 0);

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
