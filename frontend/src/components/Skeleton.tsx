import React, { useMemo } from 'react';
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

interface SkeletonGridProps {
  count?: number;
  columnCount?: number;
  /** fill: 首屏填满到视口底部；inline: 翻页追加，自然高度。 */
  variant?: 'fill' | 'inline';
}

// 内容区瀑布流骨架，Timeline / Random / Entities / Tags 内容区共用。
// 用 flex 多列布局（而非 CSS columns）以保证列数稳定、纵向堆叠，
// 避免固定高度下 CSS columns 横向溢出成多列。
export const SkeletonGrid: React.FC<SkeletonGridProps> = ({ count = 12, columnCount = 2, variant = 'fill' }) => {
  const cols = Math.max(1, columnCount);

  const columns = useMemo(() => {
    const buckets: number[][] = Array.from({ length: cols }, () => []);
    for (let i = 0; i < count; i++) {
      const h = 160 + Math.round(Math.random() * 200);
      buckets[i % cols].push(h);
    }
    return buckets;
  }, [count, cols]);

  return (
    <div className={`skeleton-grid skeleton-grid-${variant}`}>
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
