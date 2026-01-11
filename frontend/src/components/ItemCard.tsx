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

export const ItemCard: React.FC<Props> = ({ item, onClick, onDeleted }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const groupCount = item.group_items?.length ?? 0;
  const isAlbum = groupCount > 1;

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (!isAlbum) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => Math.max(0, Math.min(prev, groupCount - 1)));
  }, [isAlbum, groupCount, item.id]);

  const displayItem = isAlbum ? item.group_items![activeIndex] : item;
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

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAlbum) return;
    setActiveIndex((prev) => (prev - 1 + groupCount) % groupCount);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAlbum) return;
    setActiveIndex((prev) => (prev + 1) % groupCount);
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
          {displayItem.s3_url && (displayItem.type === 'image' || displayItem.type === 'video') ? (
            <img src={displayItem.thumbnail_url || displayItem.s3_url} alt="content" loading="lazy" />
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
              <div className="album-dots" aria-label={`Album with ${groupCount} items`}>
                {Array.from({ length: groupCount }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`album-dot ${i === activeIndex ? 'active' : ''}`}
                    aria-label={`Go to item ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveIndex(i);
                    }}
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
                <button
                  className="dropdown-item delete"
                  style={{ color: '#ff4d4f' }}
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
