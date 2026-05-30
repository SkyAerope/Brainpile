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
}

// 内容区瀑布流骨架，Timeline / Random / Entities / Tags 内容区共用
export const SkeletonGrid: React.FC<SkeletonGridProps> = ({ count = 12 }) => {
  const heights = useMemo(
    () => Array.from({ length: count }, () => 160 + Math.round(Math.random() * 200)),
    [count]
  );

  return (
    <div className="skeleton-grid">
      {heights.map((h, i) => (
        <SkeletonCard key={i} height={h} />
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
