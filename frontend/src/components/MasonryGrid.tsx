import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Item } from '../api';
import { ItemCard } from './ItemCard';
import { Masonry } from 'masonic';
import type { RenderComponentProps } from 'masonic';

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

  const isEntitiesPage = window.location.pathname.startsWith('/entities');
  const contentWidth = isEntitiesPage ? windowWidth - 440 : windowWidth - 80;
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
        key={layoutKey ?? 'default'}
        className="my-masonry-grid"
        items={items}
        columnCount={columnCount}
        columnGutter={16}
        rowGutter={16}
        itemKey={(data, index) => (data ? data.id : `missing-${index}`)}
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
