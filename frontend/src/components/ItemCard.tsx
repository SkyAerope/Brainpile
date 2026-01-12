import React, { useEffect, useRef, useState } from 'react';
import { Item, deleteItem } from '../api';
import './ItemCard.css';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, MoreHorizontal, Download, Trash2, Send } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { TagIcon } from './TagIcon';

interface Props {
  item: Item;
  onClick: (item: Item, opts?: { startIndex?: number }) => void;
  onDeleted?: (id: number) => void;
}

const ANIMATION_DURATION = 300;

const globalLoadedImageUrls = new Set<string>();
const albumIndexByItemId = new Map<number, number>();

function getCardPreviewUrl(it: Item): string | null {
  if (it.type === 'image') return it.thumbnail_url || it.s3_url;
  if (it.type === 'video') return it.thumbnail_url || null;
  return null;
}

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

export const ItemCard: React.FC<Props> = ({ item, onClick, onDeleted }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const groupCount = item.group_items?.length ?? 0;
  const isAlbum = groupCount > 1;

  const [activeIndex, setActiveIndex] = useState(() => {
    if (!isAlbum) return 0;
    return Math.max(0, Math.min(albumIndexByItemId.get(item.id) ?? 0, groupCount - 1));
  });
  const [isAnimating, setIsAnimating] = useState(false);

  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isAlbum) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(() => {
      const cached = albumIndexByItemId.get(item.id) ?? 0;
      return Math.max(0, Math.min(cached, groupCount - 1));
    });
  }, [isAlbum, groupCount, item.id]);

  useEffect(() => {
    if (!isAlbum) return;
    albumIndexByItemId.set(item.id, activeIndex);
  }, [isAlbum, item.id, activeIndex]);

  const displayItem = isAlbum ? item.group_items![activeIndex] : item;
  const slides = isAlbum ? item.group_items! : [item];

  const aspectRatio =
    displayItem.width && displayItem.height ? displayItem.width / displayItem.height : undefined;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleDelete = async () => {
    try {
      await deleteItem(item.id);
      onDeleted?.(item.id);
      setShowConfirm(false);
      setShowMenu(false);
    } catch {
      alert('Failed to delete item');
    }
  };

  const handleCardClick = () => {
    if (isAlbum) {
      onClick(item, { startIndex: activeIndex });
      return;
    }
    onClick(item);
  };

  const switchTo = (newIndex: number) => {
    if (!isAlbum) return;
    if (newIndex === activeIndex) return;
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex(newIndex);
    window.setTimeout(() => setIsAnimating(false), ANIMATION_DURATION);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAlbum || isAnimating) return;
    const newIndex = (activeIndex - 1 + groupCount) % groupCount;
    switchTo(newIndex);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAlbum || isAnimating) return;
    const newIndex = (activeIndex + 1) % groupCount;
    switchTo(newIndex);
  };

  const handleDotClick = (e: React.MouseEvent, targetIndex: number) => {
    e.stopPropagation();
    if (targetIndex === activeIndex || isAnimating) return;
    switchTo(targetIndex);
  };

  return (
    <div className={`item-card type-${item.type}`} onClick={handleCardClick}>
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

      {displayItem.type === 'text' ? (
        <div className="item-media-placeholder">
          <p className="text-title">{displayItem.content}</p>
        </div>
      ) : (
        <div
          className="item-media"
          style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
        >
          {(displayItem.type === 'image' || displayItem.type === 'video') ? (
            <div className="album-slider">
              <div
                className="album-track"
                style={{
                  transform: `translateX(${-activeIndex * 100}%)`,
                  transition: isAlbum ? `transform ${ANIMATION_DURATION}ms cubic-bezier(0.33, 0.33, 0, 1)` : undefined,
                }}
              >
                {slides.map((it) => {
                  const previewUrl = getCardPreviewUrl(it);
                  const isLoaded = previewUrl
                    ? (loadedImages.has(previewUrl) || globalLoadedImageUrls.has(previewUrl))
                    : true;

                  return (
                    <div key={it.id} className="album-slide">
                      {it.type === 'image' && previewUrl ? (
                        <>
                          <img
                            src={previewUrl}
                            alt="content"
                            loading="eager"
                            ref={(img) => {
                              if (!img) return;
                              if (img.complete && img.naturalWidth > 0) {
                                markImageLoaded(previewUrl, setLoadedImages);
                              }
                            }}
                            onLoad={() => markImageLoaded(previewUrl, setLoadedImages)}
                          />
                          {!isLoaded && (
                            <div className="image-loading-placeholder">
                              <ImageIcon size={32} />
                            </div>
                          )}
                        </>
                      ) : it.type === 'video' ? (
                        previewUrl ? (
                          <>
                            <img
                              src={previewUrl}
                              alt="video"
                              loading="eager"
                              ref={(img) => {
                                if (!img) return;
                                if (img.complete && img.naturalWidth > 0) {
                                  markImageLoaded(previewUrl, setLoadedImages);
                                }
                              }}
                              onLoad={() => markImageLoaded(previewUrl, setLoadedImages)}
                            />
                            {!isLoaded && (
                              <div className="image-loading-placeholder">
                                <ImageIcon size={32} />
                              </div>
                            )}
                          </>
                        ) : it.s3_url ? (
                          <video
                            className="card-video"
                            src={it.s3_url}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <div className="placeholder">
                            <ImageIcon size={48} />
                          </div>
                        )
                      ) : (
                        <div className="placeholder">
                          <ImageIcon size={48} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="placeholder">
              <ImageIcon size={48} />
            </div>
          )}

          {isAlbum && (
            <>
              <button type="button" className="album-arrow left" aria-label="Previous" onClick={handlePrev}>
                <ChevronLeft size={20} />
              </button>
              <button type="button" className="album-arrow right" aria-label="Next" onClick={handleNext}>
                <ChevronRight size={20} />
              </button>
              <div
                className="album-dots"
                aria-label={`Album with ${groupCount} items`}
                onClick={(e) => e.stopPropagation()}
              >
                {Array.from({ length: groupCount }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`album-dot ${i === activeIndex ? 'active' : ''}`}
                    aria-label={`Go to item ${i + 1}`}
                    onClick={(e) => handleDotClick(e, i)}
                  />
                ))}
              </div>
            </>
          )}

          <div className="overlay">
            <button className="view-btn">View</button>
            {displayItem.source_url && (
              <a
                href={displayItem.source_url}
                target="_blank"
                rel="noreferrer"
                className="source-link"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={14} />
                <span>Source</span>
              </a>
            )}
          </div>
        </div>
      )}

      <div className="item-content">
        {displayItem.type !== 'text' && displayItem.content && <p className="text-title">{displayItem.content}</p>}
        {!!item.tag_objects?.length && (
          <div className="item-tags" onClick={(e) => e.stopPropagation()}>
            {item.tag_objects.slice(0, 8).map((tag) => (
              <span key={tag.id} className="tag-pill" title={tag.label ?? undefined}>
                <TagIcon tag={tag} size={16} title={tag.label ?? undefined} />
              </span>
            ))}
          </div>
        )}
        <div className="item-meta">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span className="type-badge">{item.type}</span>
            <span className="date">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
          </div>
          <div className="item-more-container" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button className="more-btn" onClick={() => setShowMenu(!showMenu)}>
              <MoreHorizontal size={16} />
            </button>
            {showMenu && (
              <div className="dropdown-menu">
                {item.source_url && (
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(item.source_url as string, '_blank');
                      setShowMenu(false);
                    }}
                  >
                    <Send size={18} />
                    <span>Open in Telegram</span>
                  </button>
                )}
                {displayItem.type !== 'text' && (
                  <button
                      className="dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/api/v1/items/${item.id}/raw`, '_blank');
                        setShowMenu(false);
                      }}
                  >
                    <Download size={18} />
                    <span>Download Raw</span>
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowConfirm(true);
                  }}
                >
                  <Trash2 size={18} />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
