import React, { useMemo, useSyncExternalStore, useRef, useEffect } from 'react';
import { Item } from '../api';
import { ItemCard } from './ItemCard';

interface MasonryGridProps {
  items: Item[];
  columnCount?: number;
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

function estimateHeight(item: Item) {
  let score = 0;
  if (item.width && item.height) {
    score += (item.height / item.width) * 1000;
  } else if (item.type !== 'text') {
    score += 600;
  }
  if (item.content) {
    score += Math.min(item.content.length * 1.5, 200);
  }
  return score + 100;
}

export const MasonryGrid: React.FC<MasonryGridProps> = ({ items, onItemClick, onItemDelete, loading, hasMore, onLoadMore }) => {
  const windowWidth = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('resize', onStoreChange);
      return () => window.removeEventListener('resize', onStoreChange);
    },
    () => typeof window !== 'undefined' ? window.innerWidth : 1200
  );

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

  const columns = useMemo(() => {
    const cols: Item[][] = Array.from({ length: columnCount }, () => []);
    const heights = new Array(columnCount).fill(0);

    items.forEach((item) => {
      let minHeight = heights[0];
      let minIdx = 0;
      for (let i = 1; i < columnCount; i++) {
        if (heights[i] < minHeight) {
          minHeight = heights[i];
          minIdx = i;
        }
      }
      cols[minIdx].push(item);
      heights[minIdx] += estimateHeight(item);
    });
    return cols;
  }, [items, columnCount]);

  return (
    <>
      <div className="my-masonry-grid">
        {columns.map((colItems, i) => (
          <div key={i} className="my-masonry-grid_column" style={{ flex: 1 }}>
            {colItems.map(item => (
              <div key={item.id} style={{ marginBottom: '16px' }}>
                <ItemCard 
                    item={item} 
                    onClick={() => onItemClick(item)} 
                    onDeleted={onItemDelete}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
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
            {loading ? '加载中' : 'Load More'}
          </button>
        </div>
      )}
    </>
  );
};
