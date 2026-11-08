import React, { useEffect, useState } from 'react';
import { coverOf, photoAlt, photoFallback, photoSrcSet, trips } from '../data/trips';
import type { Section, Trip } from '../data/trips';
import { ArrowLeftIcon } from './Icons';
import { Lightbox } from './Lightbox';

const SITE = 'https://jaredn.dev';

/** Keeps the tab title and canonical URL right on client-rendered routes. */
function usePageMeta(title: string, path: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href;
    if (canonical) canonical.href = `${SITE}${path}`;
    return () => {
      document.title = previousTitle;
      if (canonical && previousCanonical) canonical.href = previousCanonical;
    };
  }, [title, path]);
}

const TripCard: React.FC<{ trip: Trip }> = ({ trip }) => {
  const cover = coverOf(trip);
  return (
    <a href={`/photos/${trip.slug}`} className="group block space-y-2.5">
      <div
        className="overflow-hidden rounded bg-zinc-900 border border-zinc-800/80 group-hover:border-zinc-600 transition-colors"
        style={{ aspectRatio: '4 / 3' }}
      >
        <img
          src={photoFallback(trip, cover)}
          srcSet={photoSrcSet(trip, cover)}
          sizes="(min-width: 768px) 33vw, 50vw"
          alt={`${trip.title} cover`}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white">{trip.title}</h3>
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
          {trip.location} · {trip.date}
        </p>
      </div>
    </a>
  );
};

const TripIndex: React.FC = () => {
  usePageMeta('Photos | Jared Nussbaum', '/photos');

  return (
    <div className="space-y-8">
      <title>Photos | Jared Nussbaum</title>
      <link rel="canonical" href={`${SITE}/photos`} />
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-widest text-zinc-500">Photos</div>
        <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">Travel photography.</p>
      </div>

      {trips.length === 0 ? (
        <p className="text-sm font-mono text-zinc-500">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-8">
          {trips.map((trip) => (
            <TripCard key={trip.slug} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Responsive column count matching Tailwind's default `sm` (640px) and `lg` (1024px) breakpoints. */
function useColumnCount(): number {
  const getCount = () => {
    if (typeof window === 'undefined') return 3;
    if (window.matchMedia('(min-width: 1024px)').matches) return 3;
    if (window.matchMedia('(min-width: 640px)').matches) return 2;
    return 1;
  };
  const [cols, setCols] = useState<number>(getCount);

  useEffect(() => {
    const lg = window.matchMedia('(min-width: 1024px)');
    const sm = window.matchMedia('(min-width: 640px)');
    const update = () => setCols(getCount());
    lg.addEventListener('change', update);
    sm.addEventListener('change', update);
    return () => {
      lg.removeEventListener('change', update);
      sm.removeEventListener('change', update);
    };
  }, []);

  return cols;
}

/**
 * Left-to-right chronological masonry: places each photo into the shortest column
 * (breaking ties left-to-right) so reading order flows across and down while keeping
 * columns balanced.
 */
const PhotoGrid: React.FC<{
  trip: Trip;
  items: Section['photos'];
  onOpen: (index: number) => void;
  cols: number;
}> = ({ trip, items, onOpen, cols }) => {
  const colCount = Math.max(1, cols);
  const columns: Section['photos'][] = Array.from({ length: colCount }, () => []);
  const heights = new Array<number>(colCount).fill(0);

  for (const item of items) {
    let targetCol = 0;
    for (let c = 1; c < colCount; c++) {
      if (heights[c] < heights[targetCol] - 0.01) {
        targetCol = c;
      }
    }
    columns[targetCol].push(item);
    heights[targetCol] += item.photo.height / item.photo.width + 0.04;
  }

  return (
    <div
      className="grid gap-3 items-start"
      style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
    >
      {columns.map((colItems, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-3">
          {colItems.map(({ photo, index }) => (
            <button
              key={`${photo.file}-${index}`}
              onClick={() => onOpen(index)}
              aria-label={`${photoAlt(trip, photo, index)} (Open photo ${index + 1} of ${trip.photos.length})`}
              className="relative block w-full overflow-hidden rounded bg-zinc-900 cursor-zoom-in hover:opacity-90 transition-opacity"
              style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
            >
              <img
                src={photoFallback(trip, photo)}
                srcSet={photoSrcSet(trip, photo)}
                sizes="(min-width: 1152px) 360px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                width={photo.width}
                height={photo.height}
                alt=""
                loading={index < 3 ? 'eager' : 'lazy'}
                decoding="async"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

const TripView: React.FC<{ trip: Trip }> = ({ trip }) => {
  usePageMeta(`${trip.title} | Photos | Jared Nussbaum`, `/photos/${trip.slug}`);
  const [open, setOpen] = useState<number | null>(null);
  const cols = useColumnCount();

  return (
    <div className="space-y-8">
      <title>{`${trip.title} | Photos | Jared Nussbaum`}</title>
      <link rel="canonical" href={`${SITE}/photos/${trip.slug}`} />
      {trip.blurb && <meta name="description" content={trip.blurb} />}
      <div className="space-y-3">
        <a
          href="/photos"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeftIcon size={12} />
          <span>all trips</span>
        </a>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{trip.title}</h1>
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
          {trip.location} · {trip.date} · {trip.photos.length} photos
        </p>
        {trip.blurb && <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">{trip.blurb}</p>}
      </div>

      <div className="space-y-12">
        {trip.sections.map((section, i) => (
          <section
            key={`${section.title ?? 'photos'}-${i}`}
            className={`space-y-5 ${i > 0 ? 'pt-10 border-t border-zinc-800/60' : ''}`}
          >
            {(section.label || section.title || section.text.length > 0) && (
              <div className="space-y-2">
                {section.label && (
                  <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">{section.label}</p>
                )}
                {section.title && <h2 className="text-lg font-semibold text-zinc-100">{section.title}</h2>}
                {section.stats && (
                  <div className="space-y-0.5">
                    {(Array.isArray(section.stats) ? section.stats : [section.stats]).map((s, idx) => (
                      <p key={idx} className="text-xs font-mono text-emerald-400/90 font-medium">
                        {s}
                      </p>
                    ))}
                  </div>
                )}
                {section.text.map((paragraph, p) => (
                  <p key={p} className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                    {paragraph}
                  </p>
                ))}
              </div>
            )}
            {section.photos.length > 0 && (
              <PhotoGrid trip={trip} items={section.photos} onOpen={setOpen} cols={cols} />
            )}
          </section>
        ))}
      </div>

      {open !== null && (
        <Lightbox trip={trip} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};

const NotFound: React.FC = () => {
  usePageMeta('Not found | Jared Nussbaum', '/photos');
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">That trip doesn't exist.</p>
      <a href="/photos" className="text-xs font-mono text-zinc-300 hover:text-white underline underline-offset-4">
        all trips
      </a>
    </div>
  );
};

export const PhotosPage: React.FC<{ slug?: string }> = ({ slug }) => {
  if (!slug) return <TripIndex />;
  const trip = trips.find((t) => t.slug === slug);
  return trip ? <TripView trip={trip} /> : <NotFound />;
};
