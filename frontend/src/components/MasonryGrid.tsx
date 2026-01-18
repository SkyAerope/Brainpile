import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Item } from '../api';
import { ItemCard } from './ItemCard';
import { useContainerPosition, useMasonry, usePositioner, useResizeObserver } from 'masonic';
import type { RenderComponentProps } from 'masonic';

// FLIP animation: 记录上一次“稳定布局”的快照，resize 时等 positioner 同步高度后再动画。
const ANIMATION_DURATION_MS = 200;
const ANIMATION_EASING = 'cubic-bezier(0.33, 0.33, 0, 1)';

type LayoutSnapshot = { top: number; left: number; width: number; height: number };
type FlipEntry = { el: HTMLElement; index: number };

function getMasonicWrapper(el: HTMLElement): HTMLElement | null {
  // masonic 把 top/left/width 设在外层容器上
  return el.parentElement as HTMLElement | null;
}

function isMasonicMeasuring(wrapper: HTMLElement): boolean {
  const style = wrapper.style;
  return style.visibility === 'hidden' || style.zIndex === '-1000';
}

function readSnapshot(wrapper: HTMLElement): LayoutSnapshot {
  const style = wrapper.style;
  const top = parseFloat(style.top) || 0;
  const left = parseFloat(style.left) || 0;
  const width = parseFloat(style.width) || wrapper.offsetWidth;
  const height = wrapper.offsetHeight;
  return { top, left, width, height };
}

function readVisualSnapshot(wrapper: HTMLElement): LayoutSnapshot {
  const rect = wrapper.getBoundingClientRect();
  const offsetParent = wrapper.offsetParent as HTMLElement | null;
  const parentRect = offsetParent ? offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    top: rect.top - parentRect.top,
    left: rect.left - parentRect.left,
    width: rect.width,
    height: rect.height,
  };
}

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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debouncedValue;
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
  const debouncedWindowWidth = useDebouncedValue(windowWidth, 300);

  const containerRef = useRef<HTMLElement | null>(null);
  const { scrollEl, scrollTop, height, isScrolling } = useScrollContainerMetrics('.main-scroll');
  
  // 当 layoutKey 变化时清空位置缓存，避免错误的动画
  const prevLayoutKeyRef = useRef(layoutKey);
  useEffect(() => {
    if (prevLayoutKeyRef.current !== layoutKey) {
      prevLayoutKeyRef.current = layoutKey;
    }
  }, [layoutKey]);

  // Masonic caches layout by index; if the items array shrinks (e.g. delete/reset/query switch),
  // it may render with stale indices before any effects run. Detect shrink synchronously and
  // invalidate positioner via deps to drop internal caches (without remounting DOM, so animations work).
  const prevLenRef = useRef(items.length);
  const shrinkNonceRef = useRef(0);
  if (items.length < prevLenRef.current) {
    shrinkNonceRef.current += 1;
  }
  prevLenRef.current = items.length;
  const shrinkNonce = shrinkNonceRef.current;

  const safeItems = useMemo(() => items.filter(isValidItem), [items]);

  const isDrawerPage = window.location.pathname.startsWith('/entities') || window.location.pathname.startsWith('/tags');
  const isRandomPage = window.location.pathname.startsWith('/random');

  // 记录最近一次“布局变化”（resize 或列宽变化），用于让 resize 后新进入视口的 item 也能动画一次。
  const layoutChangeTokenRef = useRef(0);
  const lastLayoutChangeAtRef = useRef(0);
  useEffect(() => {
    layoutChangeTokenRef.current += 1;
    lastLayoutChangeAtRef.current = Date.now();
  }, [debouncedWindowWidth, isDrawerPage]);

  const containerPosition = useContainerPosition(containerRef, [debouncedWindowWidth, isDrawerPage]);
  const fallbackWidth = isDrawerPage ? debouncedWindowWidth - 440 : debouncedWindowWidth - 80;
  const effectiveWidth = Math.max(1, containerPosition.width || fallbackWidth);
  const columnCount = getColumnCount(effectiveWidth);
  const pendingResizeRef = useRef(false);
  const lastEffectiveWidthRef = useRef(effectiveWidth);

  useEffect(() => {
    if (lastEffectiveWidthRef.current !== effectiveWidth) {
      pendingResizeRef.current = true;
      lastEffectiveWidthRef.current = effectiveWidth;
    }
  }, [effectiveWidth]);

  // 列数变化时，临时禁用虚拟滚动，全部渲染测量
  const prevColumnCountRef = useRef(columnCount);
  const [isMeasuring, setIsMeasuring] = useState(false);
  useEffect(() => {
    if (prevColumnCountRef.current !== columnCount) {
      setIsMeasuring(true);
      const timer = setTimeout(() => setIsMeasuring(false), 500);
      prevColumnCountRef.current = columnCount;
      return () => clearTimeout(timer);
    }
  }, [columnCount]);

  const positioner = usePositioner(
    {
      width: effectiveWidth,
      columnCount,
      columnGutter: 16,
      rowGutter: 16,
    },
    [effectiveWidth, columnCount, shrinkNonce, layoutKey]
  );
  const resizeObserver = useResizeObserver(positioner);

  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || !hasMore) return;

    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        onLoadMore();
      }
    }, { root: scrollEl ?? null, rootMargin: '1200px' }); 

    if (loaderRef.current) {
      obs.observe(loaderRef.current);
    }
    
    return () => obs.disconnect();
  }, [loading, hasMore, onLoadMore, scrollEl]);

  // FLIP: itemKey -> inner element + index
  const flipRefs = useRef<Map<string | number, FlipEntry>>(new Map());
  const prevSnapshotsRef = useRef<Map<string | number, LayoutSnapshot>>(new Map());
  const runningAnimations = useRef<WeakMap<HTMLElement, Animation>>(new WeakMap());
  const lastAppliedLayoutChangeTokenRef = useRef<number>(0);

  useLayoutEffect(() => {
    const currentSnapshots = new Map<string | number, LayoutSnapshot>();
    const entries: Array<{ key: string | number; wrapper: HTMLElement; snapshot: LayoutSnapshot }> = [];
    let layoutStable = true;
    let checkedPositioner = false;
    // const now = Date.now();

    flipRefs.current.forEach((entry, key) => {
      const el = entry.el;
      const index = entry.index;
      if (!el || !el.isConnected) return;
      const wrapper = getMasonicWrapper(el);
      if (!wrapper || !wrapper.isConnected) return;
      if (isMasonicMeasuring(wrapper)) return;

      const current = readSnapshot(wrapper);
      currentSnapshots.set(key, current);
      entries.push({ key, wrapper, snapshot: current });

      if (pendingResizeRef.current) {
        const position = positioner.get(index);
        if (position) {
          checkedPositioner = true;
          if (Math.abs(position.height - current.height) > 0.5) {
            layoutStable = false;
          }
        }
      }
    });

    if (pendingResizeRef.current && checkedPositioner && !layoutStable) {
      return;
    }

    entries.forEach(({ key, wrapper, snapshot: current }) => {
      const prev = prevSnapshotsRef.current.get(key);

      // 1) 位置/宽度/高度变化：translate + scaleX + scaleY
      if (prev) {
        const layoutDeltaX = prev.left - current.left;
        const layoutDeltaY = prev.top - current.top;
        const layoutScaleX = current.width > 0 ? prev.width / current.width : 1;
        const layoutScaleY = current.height > 0 ? prev.height / current.height : 1;

        const moved = Math.abs(layoutDeltaX) > 0.5 || Math.abs(layoutDeltaY) > 0.5;
        const resizedX = Math.abs(layoutScaleX - 1) > 0.005;
        const resizedY = Math.abs(layoutScaleY - 1) > 0.005;
        if (!moved && !resizedX && !resizedY) return;

        const existing = runningAnimations.current.get(wrapper);
        // If an animation is in-flight, retarget from its current visual state to avoid a snap.
        const fromSnapshot = existing ? readVisualSnapshot(wrapper) : prev;
        if (existing) existing.cancel();

        const deltaX = fromSnapshot.left - current.left;
        const deltaY = fromSnapshot.top - current.top;
        const scaleX = current.width > 0 ? fromSnapshot.width / current.width : 1;
        const scaleY = current.height > 0 ? fromSnapshot.height / current.height : 1;

        wrapper.style.transformOrigin = '0 0';
        const animation = wrapper.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px) scaleX(${scaleX}) scaleY(${scaleY})` },
            { transform: 'translate(0px, 0px) scaleX(1) scaleY(1)' },
          ],
          {
            duration: ANIMATION_DURATION_MS,
            easing: ANIMATION_EASING,
          }
        );

        runningAnimations.current.set(wrapper, animation);
        animation.finished
          // .catch(() => console.log(`Animation cancelled for item ${key} with deltaX=${deltaX}, deltaY=${deltaY}, scaleX=${scaleX}, scaleY=${scaleY}`))
          .catch(() => undefined)
          .finally(() => {
            if (runningAnimations.current.get(wrapper) === animation) {
              runningAnimations.current.delete(wrapper);                              
            }
            wrapper.style.transformOrigin = '';
            animation.cancel();
          });
        return;
      }

      // 2) 没有 prev：通常是虚拟化或 resize 后“新进入视口”的元素。
      //    仅在最近一次 layout change 后短时间内，做一次轻量 enter 动画（不依赖 CSS）。
      // const lastChangeAt = lastLayoutChangeAtRef.current;
      // const isRecentLayoutChange = now - lastChangeAt < 800;
      // const token = layoutChangeTokenRef.current;
      // const shouldEnterAnimate = isRecentLayoutChange && token !== lastAppliedLayoutChangeTokenRef.current;
      // if (shouldEnterAnimate) {
      //   const existing = runningAnimations.current.get(wrapper);
      //   if (existing) existing.cancel();
      //   const animation = wrapper.animate(
      //     [
      //       { transform: 'translateY(12px)', opacity: 0.001 },
      //       { transform: 'translateY(0px)', opacity: 1 },
      //     ],
      //     {
      //       duration: Math.min(220, ANIMATION_DURATION_MS),
      //       easing: 'ease-out',
      //     }
      //   );
      //   runningAnimations.current.set(wrapper, animation);
      //   animation.finished
      //     .catch(() => undefined)
      //     .finally(() => {
      //       if (runningAnimations.current.get(wrapper) === animation) {
      //         runningAnimations.current.delete(wrapper);
      //       }
      //       animation.cancel();
      //     });
      // }
    });

    lastAppliedLayoutChangeTokenRef.current = layoutChangeTokenRef.current;
    prevSnapshotsRef.current = currentSnapshots;
    if (pendingResizeRef.current) {
      pendingResizeRef.current = false;
    }
  });
  
  const renderCard = useCallback(
    ({ data, index }: RenderComponentProps<Item>) => {
      if (!data) return null;
      const key = isRandomPage ? (data.clientKey ?? data.id) : data.id;
      return (
        <div
          ref={(el) => {
            if (el) {
              flipRefs.current.set(key, { el, index });
            } else {
              flipRefs.current.delete(key);
            }
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <ItemCard
            item={data}
            onClick={(item, opts) => onItemClick(item, opts)}
            onDeleted={onItemDelete}
          />
        </div>
      );
    },
    [onItemClick, onItemDelete, isRandomPage]
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
    // 非 Random 页：稳定 key，删除时其它元素才能平滑移动而不是 remount
    // Random 页：允许重复 id，优先使用 clientKey（稳定，不依赖 index）
    itemKey: (data, index) => isRandomPage ? (data.clientKey ?? `${data.id}:${index}`) : data.id,
    render: renderCard,
    overscanBy: isMeasuring ? safeItems.length : 2,
  });

  return (
    <>
      {masonry}
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
