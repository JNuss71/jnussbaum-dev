import React, { useCallback, useEffect, useRef } from 'react';
import { photoFallback, photoSrcSet } from '../data/trips';
import type { Trip } from '../data/trips';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from './Icons';

interface LightboxProps {
  trip: Trip;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 50;

export const Lightbox: React.FC<LightboxProps> = ({ trip, index, onIndexChange, onClose }) => {
  const total = trip.photos.length;
  const photo = trip.photos[index];
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(() => onIndexChange((index - 1 + total) % total), [index, total, onIndexChange]);
  const next = useCallback(() => onIndexChange((index + 1) % total), [index, total, onIndexChange]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  // Lock page scroll and restore focus to whatever opened the lightbox.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  // Warm the cache for the neighbours.
  useEffect(() => {
    for (const offset of [-1, 1]) {
      const neighbour = trip.photos[(index + offset + total) % total];
      const img = new Image();
      img.sizes = '100vw';
      img.srcset = photoSrcSet(trip, neighbour);
      img.src = photoFallback(trip, neighbour);
    }
  }, [trip, index, total]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${trip.title} photo viewer`}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col outline-none"
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) > SWIPE_THRESHOLD) {
          if (dx > 0) prev();
          else next();
        }
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-xs font-mono text-zinc-400">
        <span>
          {index + 1} / {total}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-2 -m-2 hover:text-white transition-colors cursor-pointer"
        >
          <XIcon size={20} />
        </button>
      </div>

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <button
          onClick={prev}
          aria-label="Previous photo"
          className="hidden sm:flex absolute left-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronLeftIcon size={28} />
        </button>

        <img
          key={photo.file}
          src={photoFallback(trip, photo)}
          srcSet={photoSrcSet(trip, photo)}
          sizes="100vw"
          width={photo.width}
          height={photo.height}
          alt={photo.caption ?? `${trip.title}, photo ${index + 1}`}
          className="max-w-full max-h-full w-auto h-auto object-contain select-none"
          draggable={false}
        />

        <button
          onClick={next}
          aria-label="Next photo"
          className="hidden sm:flex absolute right-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronRightIcon size={28} />
        </button>
      </div>

      <div className="px-4 py-3 text-center text-xs font-mono text-zinc-400 min-h-[2.5rem]">
        {photo.caption ?? ''}
      </div>
    </div>
  );
};
