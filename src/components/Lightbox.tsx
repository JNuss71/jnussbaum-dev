import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  // Zoom and pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);

  // Gesture tracking refs
  const touchStartDist = useRef<number | null>(null);
  const touchStartScale = useRef<number>(1);
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartTranslate = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTap = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const swipeStartX = useRef<number | null>(null);
  const isPinching = useRef<boolean>(false);
  const isPanning = useRef<boolean>(false);

  const [prevIndex, setPrevIndex] = useState(index);

  // Reset zoom synchronously when photo changes (official React pattern, avoids cascading render)
  if (prevIndex !== index) {
    setPrevIndex(index);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  const prev = useCallback(() => onIndexChange((index - 1 + total) % total), [index, total, onIndexChange]);
  const next = useCallback(() => onIndexChange((index + 1) % total), [index, total, onIndexChange]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (scale > 1) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'ArrowRight') {
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next, scale]);

  // Lock page scroll, trap focus, and restore focus to opener.
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
      opener?.focus?.();
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

  const handleDoubleTap = useCallback(() => {
    if (scale > 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(2.5);
      setTranslate({ x: 0, y: 0 });
    }
  }, [scale]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      isPanning.current = false;
      swipeStartX.current = null;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDist.current = dist;
      touchStartScale.current = scale;
      setIsGesturing(true);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      touchStartTranslate.current = { ...translate };

      if (scale > 1) {
        isPanning.current = true;
        swipeStartX.current = null;
        setIsGesturing(true);
      } else {
        swipeStartX.current = touch.clientX;
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current && touchStartDist.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newScale = Math.min(Math.max(touchStartScale.current * (dist / touchStartDist.current), 1), 4);
      setScale(newScale);
    } else if (e.touches.length === 1 && isPanning.current && scale > 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPos.current.x;
      const dy = touch.clientY - touchStartPos.current.y;
      const maxBoundX = (window.innerWidth * (scale - 1)) / 2;
      const maxBoundY = (window.innerHeight * (scale - 1)) / 2;
      const nextX = Math.min(Math.max(touchStartTranslate.current.x + dx, -maxBoundX), maxBoundX);
      const nextY = Math.min(Math.max(touchStartTranslate.current.y + dy, -maxBoundY), maxBoundY);
      setTranslate({ x: nextX, y: nextY });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    setIsGesturing(false);

    if (isPinching.current) {
      isPinching.current = false;
      touchStartDist.current = null;
      if (scale < 1.05) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
      return;
    }

    if (isPanning.current) {
      isPanning.current = false;
      return;
    }

    // Double-tap detection
    if (e.changedTouches.length === 1 && scale === 1) {
      const now = Date.now();
      const touch = e.changedTouches[0];
      const timeDiff = now - lastTap.current.time;
      const distDiff = Math.hypot(touch.clientX - lastTap.current.x, touch.clientY - lastTap.current.y);

      if (timeDiff < 300 && distDiff < 25) {
        handleDoubleTap();
        lastTap.current = { time: 0, x: 0, y: 0 };
        swipeStartX.current = null;
        return;
      }
      lastTap.current = { time: now, x: touch.clientX, y: touch.clientY };
    }

    // Single-finger swipe when unzoomed
    if (scale === 1 && swipeStartX.current !== null && e.changedTouches.length > 0) {
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
      aria-label={`${trip.title} photo viewer`}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col outline-none select-none"
    >
      <div className="flex items-center justify-between px-4 py-3 text-xs font-mono text-zinc-400 z-10">
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
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14 overflow-hidden touch-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => {
          if (e.target === e.currentTarget && scale === 1) onClose();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleDoubleTap();
        }}
      >
        {scale === 1 && (
          <button
            onClick={prev}
            aria-label="Previous photo"
            className="hidden sm:flex absolute left-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer z-10"
          >
            <ChevronLeftIcon size={28} />
          </button>
        )}

        <img
          key={photo.file}
          src={photoFallback(trip, photo)}
          srcSet={photoSrcSet(trip, photo)}
          sizes={responsiveSizes}
          width={photo.width}
          height={photo.height}
          alt={photoAlt(trip, photo, index)}
          className="max-w-full max-h-full w-auto h-auto object-contain select-none will-change-transform"
          style={{
            transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
            transition: isGesturing ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
          draggable={false}
        />

        {scale === 1 && (
          <button
            onClick={next}
            aria-label="Next photo"
            className="hidden sm:flex absolute right-3 p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer z-10"
          >
            <ChevronRightIcon size={28} />
          </button>
        )}
      </div>

      <div className="px-4 py-3 text-center text-xs font-mono text-zinc-400 min-h-[2.5rem] z-10">
        {photo.caption ?? ''}
      </div>
    </div>
  );
};
