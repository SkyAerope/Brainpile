import React, { useEffect, useMemo, useState } from 'react';
import { Item, ItemDetail, fetchItemDetail, deleteItem } from '../api';
import './ItemModal.css';
import { Calendar, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { TagIcon } from './TagIcon';

interface Props {
  itemId: number;
  groupItems?: Item[];
  startIndex?: number;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

const ANIMATION_DURATION = 300;

const globalLoadedImageUrls = new Set<string>();
const globalInflightImageLoads = new Map<string, Promise<void>>();

function preloadImageOnce(url: string): Promise<void> {
  if (globalLoadedImageUrls.has(url)) return Promise.resolve();
  const inflight = globalInflightImageLoads.get(url);
  if (inflight) return inflight;

  const p = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      globalLoadedImageUrls.add(url);
      globalInflightImageLoads.delete(url);
      resolve();
    };
    img.onerror = (e) => {
      globalInflightImageLoads.delete(url);
      reject(e);
    };
    img.src = url;
  });

  globalInflightImageLoads.set(url, p);
  return p;
}

export const ItemModal: React.FC<Props> = ({ itemId, groupItems, startIndex, onClose, onDeleted }) => {
  // 所有组图项的详情缓存
  const [detailsCache, setDetailsCache] = useState<Map<number, ItemDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  // 跟踪图片加载状态
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  // 动画状态：保存上一张图的索引和滑动方向
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

  const album = useMemo(() => (groupItems && groupItems.length > 1 ? groupItems : null), [groupItems]);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (!album) {
      setActiveIndex(0);
      return;
    }
    const idx = Math.max(0, Math.min((startIndex ?? 0), album.length - 1));
    setActiveIndex(idx);
  }, [album, startIndex]);

  const currentItemId = album ? album[Math.min(activeIndex, album.length - 1)].id : itemId;

  // 当前显示项的详情（需要在预加载逻辑之前可用）
  const detail = detailsCache.get(currentItemId) ?? null;

  const previewItem = useMemo(() => {
    if (!album) return null;
    return album[Math.min(activeIndex, album.length - 1)];
  }, [album, activeIndex]);

  const prevPreviewItem = useMemo(() => {
    if (!album || prevIndex === null) return null;
    return album[Math.min(prevIndex, album.length - 1)];
  }, [album, prevIndex]);

  const albumCaption = useMemo(() => {
    if (!album) return null;
    for (const it of album) {
      if (typeof it.content === 'string' && it.content.trim().length > 0) return it.content;
    }
    return null;
  }, [album]);

  // 预加载所有组图图片（非组图时也要预加载 detail 的图，否则会一直停在 Loading）
  const allImageUrls = useMemo(() => {
    if (!album) {
      const url = detail?.s3_url;
      return url ? [url] : [];
    }
    return album
      .filter((it) => it.type === 'image' || it.type === 'video')
      .map((it) => it.s3_url)
      .filter((url): url is string => !!url);
  }, [album, detail?.s3_url]);

  useEffect(() => {
    // 预加载所有图片
    allImageUrls.forEach((url) => {
      void preloadImageOnce(url).then(() => {
        setLoadedImages((prev) => {
          if (prev.has(url)) return prev;
          const next = new Set(prev);
          next.add(url);
          return next;
        });
      });
    });
  }, [allImageUrls, loadedImages]);

  // 一次性加载所有组图项的详情
  useEffect(() => {
    const idsToFetch = album ? album.map((it) => it.id) : [itemId];
    setLoading(true);

    Promise.all(
      idsToFetch.map((id) =>
        fetchItemDetail(id)
          .then((detail) => ({ id, detail }))
          .catch((err) => {
            console.error(`Failed to fetch detail for item ${id}:`, err);
            return null;
          })
      )
    ).then((results) => {
      const newCache = new Map<number, ItemDetail>();
      results.forEach((r) => {
        if (r && r.detail) {
          newCache.set(r.id, r.detail);
        }
      });
      setDetailsCache(newCache);
      setLoading(false);
    });
  }, [album, itemId]);

  // 当前图片是否已加载
  const currentImageUrl = previewItem?.s3_url ?? detail?.s3_url;
  const prevImageUrl = prevPreviewItem?.s3_url ?? null;
  const isCurrentImageLoaded = currentImageUrl ? (loadedImages.has(currentImageUrl) || globalLoadedImageUrls.has(currentImageUrl)) : true;
  const isPrevImageLoaded = prevImageUrl ? (loadedImages.has(prevImageUrl) || globalLoadedImageUrls.has(prevImageUrl)) : true;

  const handleDelete = async () => {
    try {
      await deleteItem(currentItemId);
      onDeleted(currentItemId);
      onClose();
    } catch (e) {
      alert('Failed to delete item');
    }
  };

  const albumCount = album?.length ?? 0;
  const canNavigate = albumCount > 1;

  // 切换到指定索引
  const switchTo = (newIndex: number, direction: 'left' | 'right') => {
    if (newIndex === activeIndex || prevIndex !== null || !album) return;
    setPrevIndex(activeIndex);
    setSlideDirection(direction);
    setActiveIndex(newIndex);
    setTimeout(() => {
      setPrevIndex(null);
    }, ANIMATION_DURATION);
  };

  const goPrev = () => {
    if (!album || prevIndex !== null) return;
    const newIndex = (activeIndex - 1 + album.length) % album.length;
    switchTo(newIndex, 'right');
  };

  const goNext = () => {
    if (!album || prevIndex !== null) return;
    const newIndex = (activeIndex + 1) % album.length;
    switchTo(newIndex, 'left');
  };

  const handleDotClick = (e: React.MouseEvent, targetIndex: number) => {
    e.stopPropagation();
    if (targetIndex === activeIndex || prevIndex !== null || !album) return;
    const direction = targetIndex > activeIndex ? 'left' : 'right';
    switchTo(targetIndex, direction);
  };

  if (loading && detailsCache.size === 0) return <div className="modal-overlay"><div className="modal-loading">Loading...</div></div>;
  if (!detail) return null;

  const effectiveContent = albumCaption ?? detail.content;

  return (
    <div className="modal-overlay" onClick={onClose}>
      {showConfirm && (
        <ConfirmModal 
            title="Delete Item"
            message="Are you sure you want to permanently delete this item? This action cannot be undone."
            confirmLabel="Delete"
            isDanger={true}
            onConfirm={handleDelete}
            onCancel={() => setShowConfirm(false)}
        />
      )}
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>
        
        <div className="modal-body">
          {detail.type !== 'text' && (
            <div className="modal-left">
              {/* Media Preview */}
              <div className="modal-slider">
                {/* 上一张图（滑出） */}
                {prevIndex !== null && prevImageUrl && isPrevImageLoaded && (
                  <div className={`modal-slide modal-slide-out-${slideDirection}`}>
                    {prevPreviewItem?.type === 'video' ? (
                      <video src={prevImageUrl} className="modal-media" />
                    ) : (
                      <img src={prevImageUrl} alt="Previous" className="modal-media" />
                    )}
                  </div>
                )}
                {/* 当前图（滑入或静止） */}
                <div className={`modal-slide ${prevIndex !== null ? `modal-slide-in-${slideDirection}` : ''}`}>
                  {isCurrentImageLoaded ? (
                    (previewItem?.s3_url || detail.s3_url) && (
                      (previewItem?.type ?? detail.type) === 'video' ? (
                        <video controls src={(previewItem?.s3_url ?? detail.s3_url) as string} className="modal-media" />
                      ) : ((previewItem?.type ?? detail.type) === 'image' ? (
                        <img src={(previewItem?.s3_url ?? detail.s3_url) as string} alt="Full content" className="modal-media" />
                      ) : null)
                    ) || (
                      <div className="modal-placeholder">
                        {detail.type === 'text' ? <FileText size={64} /> : <ImageIcon size={64} />}
                        <p>No Media Preview</p>
                      </div>
                    )
                  ) : (
                    <div className="modal-placeholder">
                      <ImageIcon size={64} />
                      <p>Loading...</p>
                    </div>
                  )}
                </div>
              </div>

              {canNavigate && (
                <>
                  <button
                    type="button"
                    className="modal-album-arrow left"
                    aria-label="Previous"
                    onClick={(e) => {
                      e.stopPropagation();
                      goPrev();
                    }}
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    type="button"
                    className="modal-album-arrow right"
                    aria-label="Next"
                    onClick={(e) => {
                      e.stopPropagation();
                      goNext();
                    }}
                  >
                    <ChevronRight size={24} />
                  </button>
                  <div className="modal-album-dots" aria-label={`Album with ${albumCount} items`}>
                    {Array.from({ length: albumCount }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`modal-album-dot ${i === activeIndex ? 'active' : ''}`}
                        aria-label={`Go to item ${i + 1}`}
                        onClick={(e) => handleDotClick(e, i)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            )}
            
            <div className="modal-right" style={detail.type === 'text' ? { borderLeft: 'none' } : undefined}>
                <h2>{detail.type.toUpperCase()} Item</h2>
                <div className="meta-row">
                    <div className="meta-item">
                        <Calendar size={16} />
                        <span>{detail.created_at ? new Date(detail.created_at).toLocaleString() : 'N/A'}</span>
                    </div>
                    {detail.tg_link && (
                        <a href={detail.tg_link} target="_blank" rel="noopener noreferrer" className="meta-item link">
                            <ExternalLink size={16} />
                            <span>Open in Telegram</span>
                        </a>
                    )}
                </div>

                <div className="detail-section">
                    <h3>Content</h3>
                  <p className="content-text">{effectiveContent || 'No content'}</p>
                </div>

                {!!detail.tag_objects?.length && (
                  <div className="detail-section">
                    <h3>Tags</h3>
                    <div className="modal-tags">
                      {detail.tag_objects.map((tag) => (
                        <span key={tag.id} className="modal-tag-pill" title={tag.label ?? undefined}>
                          <TagIcon tag={tag} size={18} title={tag.label ?? undefined} />
                          {tag.label && <span className="modal-tag-label">{tag.label}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {detail.searchable_text && detail.searchable_text !== detail.content && (
                     <div className="detail-section">
                        <h3>AI Analysis / OCR</h3>
                        <p className="content-text secondary">{detail.searchable_text}</p>
                    </div>
                )}

                <div className="detail-section">
                    <h3>Metadata</h3>
                    <pre className="json-block">{JSON.stringify(detail.meta, null, 2)}</pre>
                </div>

                <div className="modal-actions">
                    <button className="btn btn-delete" onClick={() => setShowConfirm(true)}>
                      <Trash2 size={16} /> Delete
                    </button>
                    <a href={`/api/v1/items/${currentItemId}/raw`} target="_blank" className="btn btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Download size={16} />
                      Download Raw
                    </a>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
