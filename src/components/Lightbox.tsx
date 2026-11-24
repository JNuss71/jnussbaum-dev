import React, { useCallback, useEffect, useRef } from 'react';
import { photoAlt, photoFallback, photoSrcSet } from '../data/trips';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const swipeStartX = useRef<number | null>(null);
  const currentIndexRef = useRef(index);

  useEffect(() => {
    currentIndexRef.current = index;
  }, [index]);

  const currentSection = trip.sections.find((s) => s.photos.some((p) => p.index === index));

  // Prevent accidental browser viewport pinch-zoom on mobile while lightbox is open
  useEffect(() => {
    const preventGesture = (e: Event) => e.preventDefault();
    window.addEventListener('gesturestart', preventGesture, { passive: false });
    window.addEventListener('gesturechange', preventGesture, { passive: false });
    window.addEventListener('gestureend', preventGesture, { passive: false });

    const container = containerRef.current;
    if (!container) return;

    const onNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1 && e.cancelable) {
        e.preventDefault();
      }
    };
    container.addEventListener('touchmove', onNativeTouchMove, { passive: false });

    return () => {
      window.removeEventListener('gesturestart', preventGesture);
      window.removeEventListener('gesturechange', preventGesture);
      window.removeEventListener('gestureend', preventGesture);
      container.removeEventListener('touchmove', onNativeTouchMove);
    };
  }, []);

  const prev = useCallback(() => onIndexChange((index - 1 + total) % total), [index, total, onIndexChange]);
  const next = useCallback(() => onIndexChange((index + 1) % total), [index, total, onIndexChange]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'ArrowRight') {
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  // Lock page scroll, trap focus, and restore focus + scroll on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex="0"]'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleTab);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleTab);
      const currentPhotoBtn = document.getElementById(`photo-${currentIndexRef.current}`);
      if (currentPhotoBtn) {
        currentPhotoBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        currentPhotoBtn.focus({ preventScroll: true });
      } else {
        opener?.focus?.({ preventScroll: true });
      }
    };
  }, []);

  // Responsive sizes based on aspect ratio (avoids massive fetches for vertical portraits).
  const ar = photo.width / photo.height;
  const responsiveSizes = ar < 1 ? `min(100vw, ${Math.ceil(ar * 85)}vh)` : '100vw';

  // Warm the cache for the neighbours.
  useEffect(() => {
    for (const offset of [-1, 1]) {
      const neighbour = trip.photos[(index + offset + total) % total];
      const img = new Image();
      const nar = neighbour.width / neighbour.height;
      img.sizes = nar < 1 ? `min(100vw, ${Math.ceil(nar * 85)}vh)` : '100vw';
      img.srcset = photoSrcSet(trip, neighbour);
      img.src = photoFallback(trip, neighbour);
    }
  }, [trip, index, total]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      swipeStartX.current = e.touches[0].clientX;
    } else {
      swipeStartX.current = null;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartX.current !== null && e.changedTouches.length > 0) {
      const dx = e.changedTouches[0].clientX - swipeStartX.current;
      swipeStartX.current = null;
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        if (dx > 0) prev();
        else next();
      }
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${trip.title}${currentSection?.title ? ` - ${currentSection.title}` : ''} photo viewer`}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col outline-none select-none"
    >
      <div className="flex items-center justify-between px-4 py-3 text-xs font-mono text-zinc-400 z-10 gap-3 border-b border-white/5 bg-black/40 backdrop-blur-sm">
        <span className="shrink-0 w-20 text-left">
          {index + 1} / {total}
        </span>

        {currentSection && (currentSection.label || currentSection.title) && (
          <div
            className="flex-1 min-w-0 px-2 text-center truncate"
            title={[currentSection.label, currentSection.title].filter(Boolean).join(' · ')}
          >
            {currentSection.label && (
              <span className="text-zinc-400 font-mono text-[11px] sm:text-xs tracking-wider uppercase">
                {currentSection.label}
              </span>
            )}
            {currentSection.label && currentSection.title && (
              <span className="text-zinc-600 mx-1.5 sm:mx-2">·</span>
            )}
            {currentSection.title && (
              <span className="text-zinc-200 font-medium text-[11px] sm:text-xs font-sans">
                {currentSection.title}
              </span>
            )}
          </div>
        )}

        <div className="shrink-0 w-20 flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-2 hover:text-white transition-colors cursor-pointer"
          >
            <XIcon size={20} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14 overflow-hidden touch-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <button
          onClick={prev}
          aria-label="Previous photo"
          className="hidden sm:flex absolute left-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer z-10"
        >
          <ChevronLeftIcon size={28} />
        </button>

        <img
          key={photo.file}
          src={photoFallback(trip, photo)}
          srcSet={photoSrcSet(trip, photo)}
          sizes={responsiveSizes}
          width={photo.width}
          height={photo.height}
          alt={photoAlt(trip, photo, index)}
          className="max-w-full max-h-full w-auto h-auto object-contain select-none"
          draggable={false}
        />

        <button
          onClick={next}
          aria-label="Next photo"
          className="hidden sm:flex absolute right-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer z-10"
        >
          <ChevronRightIcon size={28} />
        </button>
      </div>

      <div className="px-4 py-3 text-center text-xs font-mono text-zinc-400 min-h-[2.5rem] z-10">
        {photo.caption ?? ''}
      </div>
    </div>
  );
};
