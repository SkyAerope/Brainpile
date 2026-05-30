import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import './Skeleton.css';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className, style }) => (
  <div className={`skeleton ${className ?? ''}`} style={style} />
);

// 瀑布流骨架卡：随机高度模拟不同图片比例
const SkeletonCard: React.FC<{ height: number }> = ({ height }) => (
  <Skeleton className="skeleton-card" style={{ height }} />
);

// 测量骨架自身顶部到滚动祖先底部的可用高度，使 fill 骨架精确填满到底，
// 既不溢出也不留边距，且不依赖各页面的 header/padding 魔数。
function useFillHeight(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const findScrollParent = (node: HTMLElement | null): HTMLElement => {
      let cur = node?.parentElement ?? null;
      while (cur) {
        const oy = getComputedStyle(cur).overflowY;
        if (oy === 'auto' || oy === 'scroll') return cur;
        cur = cur.parentElement;
      }
      return document.documentElement;
    };

    const measure = () => {
      const node = ref.current;
      if (!node) return;
      const scrollParent = findScrollParent(node);
      const parentRect = scrollParent.getBoundingClientRect();
      const parentStyle = getComputedStyle(scrollParent);
      // 滚动容器内容区底边（扣除自身底 padding）。
      const contentBottom = parentRect.bottom - parseFloat(parentStyle.paddingBottom || '0');
      const top = node.getBoundingClientRect().top;

      // 累计骨架到滚动容器之间各祖先的底部 padding，避免这些 padding 把骨架顶出而溢出。
      let extraBottom = 0;
      let cur: HTMLElement | null = node.parentElement;
      while (cur && cur !== scrollParent) {
        const cs = getComputedStyle(cur);
        extraBottom += parseFloat(cs.paddingBottom || '0');
        cur = cur.parentElement;
      }

      const available = Math.max(0, Math.floor(contentBottom - top - extraBottom));
      setHeight(available);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [enabled]);

  return { ref, height };
}

interface SkeletonGridProps {
  count?: number;
  columnCount?: number;
  /** fill: 首屏填满到滚动容器底部；inline: 翻页追加，自然高度。 */
  variant?: 'fill' | 'inline';
}

// 内容区瀑布流骨架，Timeline / Random / Entities / Tags 内容区共用。
// 用 flex 多列布局（而非 CSS columns）以保证列数稳定、纵向堆叠，
// 避免固定高度下 CSS columns 横向溢出成多列。
export const SkeletonGrid: React.FC<SkeletonGridProps> = ({ count = 12, columnCount = 2, variant = 'fill' }) => {
  const cols = Math.max(1, columnCount);
  const { ref, height } = useFillHeight(variant === 'fill');

  const columns = useMemo(() => {
    const buckets: number[][] = Array.from({ length: cols }, () => []);
    for (let i = 0; i < count; i++) {
      const h = 160 + Math.round(Math.random() * 200);
      buckets[i % cols].push(h);
    }
    return buckets;
  }, [count, cols]);

  return (
    <div
      ref={ref}
      className={`skeleton-grid skeleton-grid-${variant}`}
      style={variant === 'fill' && height !== undefined ? { height } : undefined}
    >
      {columns.map((heights, c) => (
        <div className="skeleton-grid-col" key={c}>
          {heights.map((h, i) => (
            <SkeletonCard key={i} height={h} />
          ))}
        </div>
      ))}
    </div>
  );
};

// 侧栏列表行骨架，匹配 .entity-item，Entities / Tags 侧栏共用
const SkeletonListRow: React.FC = () => (
  <div className="skeleton-list-row">
    <Skeleton className="skeleton-avatar" />
    <div className="skeleton-list-text">
      <Skeleton className="skeleton-line" style={{ width: '60%' }} />
      <Skeleton className="skeleton-line" style={{ width: '40%' }} />
    </div>
  </div>
);

interface SkeletonListProps {
  count?: number;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ count = 12 }) => (
  <div className="skeleton-list">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonListRow key={i} />
    ))}
  </div>
);

// ItemModal 详情骨架
export const SkeletonModalDetail: React.FC = () => (
  <div className="skeleton-modal">
    <Skeleton className="skeleton-modal-media" />
    <div className="skeleton-modal-info">
      <Skeleton className="skeleton-line" style={{ width: '50%', height: 22 }} />
      <Skeleton className="skeleton-line" style={{ width: '70%' }} />
      <Skeleton className="skeleton-line" style={{ width: '90%', height: 80, borderRadius: 8 }} />
      <Skeleton className="skeleton-line" style={{ width: '40%' }} />
      <Skeleton className="skeleton-line" style={{ width: '80%' }} />
    </div>
  </div>
);
