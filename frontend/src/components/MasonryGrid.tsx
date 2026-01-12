import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Item } from '../api';
import { ItemCard } from './ItemCard';
import { useContainerPosition, useMasonry, usePositioner, useResizeObserver } from 'masonic';
import type { RenderComponentProps } from 'masonic';

function isValidItem(value: unknown): value is Item {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).id === 'number'
  );
}

interface MasonryGridProps {
  items: Item[];
  columnCount?: number;
  layoutKey?: string | number;
  onItemClick: (item: Item, opts?: { startIndex?: number }) => void;
  onItemDelete?: (id: number) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

function useWindowWidth() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('resize', onStoreChange);
      return () => window.removeEventListener('resize', onStoreChange);
    },
    () => typeof window !== 'undefined' ? window.innerWidth : 1200
  );
}

function getColumnCount(width: number) {
  if (width < 500) return 1;
  if (width < 700) return 2;
  if (width < 1100) return 3;
  if (width < 1500) return 4;
  return 5;
}

function useScrollContainerMetrics(selector: string) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState<{ scrollTop: number; height: number; isScrolling: boolean }>({
    scrollTop: 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
    isScrolling: false,
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const el = document.querySelector(selector) as HTMLElement | null;
    setScrollEl(el);
    if (!el) return;

    let rafId: number | null = null;
    let scrollingTimeoutId: number | null = null;

    const read = (isScrolling: boolean) => {
      setMetrics({
        scrollTop: el.scrollTop,
        height: el.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800),
        isScrolling,
      });
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        read(true);
      });

      if (scrollingTimeoutId !== null) {
        window.clearTimeout(scrollingTimeoutId);
      }
      scrollingTimeoutId = window.setTimeout(() => read(false), 140);
    };

    const onResize = () => read(false);

    read(false);
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (scrollingTimeoutId !== null) window.clearTimeout(scrollingTimeoutId);
    };
  }, [selector]);

  return { scrollEl, ...metrics };
}

export const MasonryGrid: React.FC<MasonryGridProps> = ({
  items,
  layoutKey,
  onItemClick,
  onItemDelete,
  loading,
  hasMore,
  onLoadMore,
}) => {
  const windowWidth = useWindowWidth();

  const containerRef = useRef<HTMLElement | null>(null);
  const { scrollEl, scrollTop, height, isScrolling } = useScrollContainerMetrics('.main-scroll');

  // Masonic caches layout by index; if the items array shrinks (e.g. delete/reset/query switch),
  // it may render with stale indices before any effects run. Detect shrink synchronously and
  // force a remount via `key` to drop internal caches.
  const prevLenRef = useRef(items.length);
  const shrinkNonceRef = useRef(0);
  if (items.length < prevLenRef.current) {
    shrinkNonceRef.current += 1;
  }
  prevLenRef.current = items.length;
  const shrinkNonce = shrinkNonceRef.current;

  const safeItems = useMemo(() => items.filter(isValidItem), [items]);

  const isDrawerPage = window.location.pathname.startsWith('/entities') || window.location.pathname.startsWith('/tags');
  const contentWidth = isDrawerPage ? windowWidth - 440 : windowWidth - 80;
  const columnCount = getColumnCount(contentWidth);

  const containerPosition = useContainerPosition(containerRef, [windowWidth, isDrawerPage, columnCount]);
  const positioner = usePositioner(
    {
      width: containerPosition.width,
      columnCount,
      columnGutter: 16,
      rowGutter: 16,
    },
    [containerPosition.width, columnCount, shrinkNonce, layoutKey]
  );
  const resizeObserver = useResizeObserver(positioner);

  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || !hasMore) return;

    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        onLoadMore();
      }
    }, { root: scrollEl ?? null, rootMargin: '400px' }); 

    if (loaderRef.current) {
      obs.observe(loaderRef.current);
    }
    
    return () => obs.disconnect();
  }, [loading, hasMore, onLoadMore, scrollEl]);

  const renderCard = useCallback(
    ({ data }: RenderComponentProps<Item>) => {
      if (!data) return null;
      return (
        <ItemCard
          item={data}
          onClick={(item, opts) => onItemClick(item, opts)}
          onDeleted={onItemDelete}
        />
      );
    },
    [onItemClick, onItemDelete]
  );

  const masonry = useMasonry<Item>({
    containerRef,
    className: 'my-masonry-grid',
    items: safeItems,
    positioner,
    resizeObserver,
    scrollTop,
    height,
    isScrolling,
    itemHeightEstimate: 320,
    itemKey: (data) => data.id,
    render: renderCard,
    overscanBy: 2,
  });

  return (
    <>
      <React.Fragment key={`${layoutKey ?? 'default'}:${shrinkNonce}`}>{masonry}</React.Fragment>
      {(loading || hasMore) && (
        <div ref={loaderRef} style={{ padding: '2rem', textAlign: 'center' }}>
          <button 
            className="view-btn" 
            onClick={onLoadMore} 
            disabled={loading}
            style={{ 
              alignSelf: 'center',
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </>
  );
};
