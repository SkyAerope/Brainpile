import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Item } from '../api';
import { ItemCard } from './ItemCard';
import { Masonry } from 'masonic';
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
  onItemClick: (item: Item) => void;
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

  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || !hasMore) return;
    
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        onLoadMore();
      }
    }, { rootMargin: '400px' }); 

    if (loaderRef.current) {
      obs.observe(loaderRef.current);
    }
    
    return () => obs.disconnect();
  }, [loading, hasMore, onLoadMore]);

  const renderCard = useCallback(
    ({ data }: RenderComponentProps<Item>) => {
      if (!data) return null;
      return (
        <ItemCard
          item={data}
          onClick={() => onItemClick(data)}
          onDeleted={onItemDelete}
        />
      );
    },
    [onItemClick, onItemDelete]
  );

  return (
    <>
      <Masonry
        key={`${layoutKey ?? 'default'}:${shrinkNonce}`}
        className="my-masonry-grid"
        items={safeItems}
        columnCount={columnCount}
        columnGutter={16}
        rowGutter={16}
        itemKey={(data, index) => (data ? String(data.id) : `missing-${index}`)}
        itemHeightEstimate={320}
        render={renderCard}
      />
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
