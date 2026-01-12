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

function markImageLoaded(url: string | null | undefined, setLoadedImages: React.Dispatch<React.SetStateAction<Set<string>>>) {
  if (!url) return;
  if (!globalLoadedImageUrls.has(url)) {
    globalLoadedImageUrls.add(url);
  }
  setLoadedImages((prev) => {
    if (prev.has(url)) return prev;
    const next = new Set(prev);
    next.add(url);
    return next;
  });
}

export const ItemModal: React.FC<Props> = ({ itemId, groupItems, startIndex, onClose, onDeleted }) => {
  // 所有组图项的详情缓存
  const [detailsCache, setDetailsCache] = useState<Map<number, ItemDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [isAnimating, setIsAnimating] = useState(false);

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

  const albumCaption = useMemo(() => {
    if (!album) return null;
    for (const it of album) {
      if (typeof it.content === 'string' && it.content.trim().length > 0) return it.content;
    }
    return null;
  }, [album]);

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

  const switchTo = (newIndex: number) => {
    if (!album) return;
    if (newIndex === activeIndex) return;
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex(newIndex);
    window.setTimeout(() => setIsAnimating(false), ANIMATION_DURATION);
  };

  const goPrev = () => {
    if (!album || isAnimating) return;
    const newIndex = (activeIndex - 1 + album.length) % album.length;
    switchTo(newIndex);
  };

  const goNext = () => {
    if (!album || isAnimating) return;
    const newIndex = (activeIndex + 1) % album.length;
    switchTo(newIndex);
  };

  const handleDotClick = (e: React.MouseEvent, targetIndex: number) => {
    e.stopPropagation();
    if (targetIndex === activeIndex || isAnimating || !album) return;
    switchTo(targetIndex);
  };

  if (loading && detailsCache.size === 0) return <div className="modal-overlay"><div className="modal-loading">Loading...</div></div>;
  if (!detail) return null;

  const effectiveContent = albumCaption ?? detail.content;

  const isText = detail.type === 'text';

  const infoSection = (
    <div className="modal-info-panel">
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
        <button className="btn btn-danger" onClick={() => setShowConfirm(true)}>
          <Trash2 size={16} /> Delete
        </button>
        {!isText && (
          <a
            href={`/api/v1/items/${currentItemId}/raw`} 
            target="_blank" 
            rel="noreferrer"
            className="btn btn-secondary" 
          >
            <Download size={16} />
            Download Raw
          </a>
        )}
      </div>
    </div>
  );

  const mediaSection = !isText && (
    <div className="modal-left" onClick={onClose}>
      {/* Media Preview */}
      <div className="modal-slider">
        <div
          className="modal-track"
          style={{
            transform: `translateX(${-activeIndex * 100}%)`,
            transition: canNavigate ? `transform ${ANIMATION_DURATION}ms cubic-bezier(0.33, 0.33, 0, 1)` : undefined,
          }}
        >
          {(album ? album : [detail]).map((it: any) => {
            const type = (it.type ?? detail.type) as string;
            const url = (it.s3_url ?? detail.s3_url) as string | null | undefined;

            const isLoaded = url
              ? (loadedImages.has(url) || globalLoadedImageUrls.has(url))
              : true;

            return (
              <div key={it.id ?? itemId} className="modal-slide">
                {type === 'video' && url ? (
                  <video
                    controls
                    src={url}
                    className="modal-media"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : type === 'image' && url ? (
                  <>
                    <img
                      src={url}
                      alt="Full content"
                      className="modal-media"
                      loading="eager"
                      onClick={(e) => e.stopPropagation()}
                      ref={(img) => {
                        if (!img) return;
                        if (img.complete && img.naturalWidth > 0) {
                          markImageLoaded(url, setLoadedImages);
                        }
                      }}
                      onLoad={() => markImageLoaded(url, setLoadedImages)}
                    />
                    {!isLoaded && (
                      <div className="modal-placeholder">
                        <ImageIcon size={64} />
                        <p>Loading...</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="modal-placeholder">
                    {detail.type === 'text' ? <FileText size={64} /> : <ImageIcon size={64} />}
                    <p>No Media Preview</p>
                  </div>
                )}
              </div>
            );
          })}
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
          <div
            className="modal-album-dots"
            aria-label={`Album with ${albumCount} items`}
            onClick={(e) => e.stopPropagation()}
          >
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
  );

  return (
    <div className={`modal-overlay ${!isText ? 'media-mode' : ''}`} onClick={onClose}>
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
      
      {isText ? (
        <div className="modal-content text-item" onClick={e => e.stopPropagation()}>
          <button className="close-btn" onClick={onClose}><X size={24} /></button>
          <div className="modal-body">
            {infoSection}
          </div>
        </div>
      ) : (
        <div className="modal-content media-item" onClick={e => e.stopPropagation()}>
          <button className="close-btn floating" onClick={onClose}><X size={24} /></button>
          <div className="modal-body">
            {mediaSection}
            {infoSection}
          </div>
        </div>
      )}
    </div>
  );
};
