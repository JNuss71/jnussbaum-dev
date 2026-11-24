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
  const currentIndexRef = useRef(index);
  useEffect(() => {
    currentIndexRef.current = index;
  }, [index]);

  const currentSection = trip.sections.find((s) => s.photos.some((p) => p.index === index));

  // Zoom and pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);

  // Gesture tracking refs
  const touchStartDist = useRef<number | null>(null);
  const touchStartScale = useRef<number>(1);
  const touchStartMid = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartTranslate = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTap = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const swipeStartX = useRef<number | null>(null);
  const isPinching = useRef<boolean>(false);
  const isPanning = useRef<boolean>(false);
  const isMouseDragging = useRef<boolean>(false);
  const mouseStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseStartTranslate = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Prevent browser viewport pinch-zoom on iOS Safari and Android Chrome
  useEffect(() => {
    const preventGesture = (e: Event) => e.preventDefault();
    window.addEventListener('gesturestart', preventGesture, { passive: false });
    window.addEventListener('gesturechange', preventGesture, { passive: false });
    window.addEventListener('gestureend', preventGesture, { passive: false });

    const container = containerRef.current;
    if (!container) return;

    const onNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1 || scaleRef.current > 1) {
        if (e.cancelable) e.preventDefault();
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

  const handleDoubleTap = useCallback(
    (clientX?: number, clientY?: number) => {
      if (scale > 1) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      } else {
        const targetScale = window.innerWidth >= 768 ? 1.65 : 2.2;
        if (clientX !== undefined && clientY !== undefined) {
          const ox = clientX - window.innerWidth / 2;
          const oy = clientY - window.innerHeight / 2;
          const maxBoundX = (window.innerWidth * (targetScale - 1)) / 2;
          const maxBoundY = (window.innerHeight * (targetScale - 1)) / 2;
          const tx = Math.min(Math.max(-ox * (targetScale - 1), -maxBoundX), maxBoundX);
          const ty = Math.min(Math.max(-oy * (targetScale - 1), -maxBoundY), maxBoundY);
          setScale(targetScale);
          setTranslate({ x: tx, y: ty });
        } else {
          setScale(targetScale);
          setTranslate({ x: 0, y: 0 });
        }
      }
    },
    [scale]
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale > 1 && e.button === 0) {
      isMouseDragging.current = true;
      mouseStartPos.current = { x: e.clientX, y: e.clientY };
      mouseStartTranslate.current = { ...translate };
      setIsGesturing(true);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDragging.current || scale <= 1) return;
    const dx = e.clientX - mouseStartPos.current.x;
    const dy = e.clientY - mouseStartPos.current.y;
    const maxBoundX = (window.innerWidth * (scale - 1)) / 2;
    const maxBoundY = (window.innerHeight * (scale - 1)) / 2;
    const nextX = Math.min(Math.max(mouseStartTranslate.current.x + dx, -maxBoundX), maxBoundX);
    const nextY = Math.min(Math.max(mouseStartTranslate.current.y + dy, -maxBoundY), maxBoundY);
    setTranslate({ x: nextX, y: nextY });
  };

  const onMouseUp = () => {
    if (isMouseDragging.current) {
      isMouseDragging.current = false;
      setIsGesturing(false);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      isPanning.current = false;
      swipeStartX.current = null;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      touchStartDist.current = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      touchStartScale.current = scale;
      touchStartMid.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      touchStartTranslate.current = { ...translate };
      setIsGesturing(true);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      touchStartTranslate.current = { ...translate };

      if (scale > 1.05) {
        isPanning.current = true;
        swipeStartX.current = null;
        setIsGesturing(true);
      } else {
        isPanning.current = false;
        swipeStartX.current = touch.clientX;
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current && touchStartDist.current) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const ratio = dist / touchStartDist.current;
      const newScale = Math.min(Math.max(touchStartScale.current * ratio, 0.75), 4.5);

      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dx = midX - touchStartMid.current.x;
      const dy = midY - touchStartMid.current.y;

      setScale(newScale);
      setTranslate({
        x: touchStartTranslate.current.x + dx,
        y: touchStartTranslate.current.y + dy,
      });
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

    // If one finger was lifted while pinching, transition smoothly to single-finger panning
    if (isPinching.current && e.touches.length === 1) {
      isPinching.current = false;
      touchStartDist.current = null;
      if (scale > 1.05) {
        const remaining = e.touches[0];
        touchStartPos.current = { x: remaining.clientX, y: remaining.clientY };
        touchStartTranslate.current = { ...translate };
        isPanning.current = true;
        setIsGesturing(true);
        return;
      }
    }

    if (e.touches.length === 0) {
      if (isPinching.current) {
        isPinching.current = false;
        touchStartDist.current = null;
      }
      if (isPanning.current) {
        isPanning.current = false;
      }

      if (scale < 1.05) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      } else {
        const clampedScale = Math.min(scale, 4);
        if (clampedScale !== scale) {
          setScale(clampedScale);
        }
        const maxBoundX = (window.innerWidth * (clampedScale - 1)) / 2;
        const maxBoundY = (window.innerHeight * (clampedScale - 1)) / 2;
        const clampedX = Math.min(Math.max(translate.x, -maxBoundX), maxBoundX);
        const clampedY = Math.min(Math.max(translate.y, -maxBoundY), maxBoundY);
        setTranslate({ x: clampedX, y: clampedY });
      }
    }

    // Double-tap detection: resets when zoomed, zooms in when unzoomed
    if (e.changedTouches.length === 1 && !isPinching.current) {
      const now = Date.now();
      const touch = e.changedTouches[0];
      const timeDiff = now - lastTap.current.time;
      const distDiff = Math.hypot(touch.clientX - lastTap.current.x, touch.clientY - lastTap.current.y);

      if (timeDiff < 300 && distDiff < 30) {
        handleDoubleTap(touch.clientX, touch.clientY);
        lastTap.current = { time: 0, x: 0, y: 0 };
        swipeStartX.current = null;
        return;
      }
      lastTap.current = { time: now, x: touch.clientX, y: touch.clientY };
    }

    // Single-finger swipe when unzoomed
    if (scale <= 1.05 && swipeStartX.current !== null && e.changedTouches.length > 0) {
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
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={(e) => {
          if (e.target === e.currentTarget && scale === 1) onClose();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleDoubleTap(e.clientX, e.clientY);
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
            cursor: scale > 1 ? (isGesturing ? 'grabbing' : 'grab') : 'zoom-in',
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
