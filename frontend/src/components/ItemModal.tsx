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

export const ItemModal: React.FC<Props> = ({ itemId, groupItems, startIndex, onClose, onDeleted }) => {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

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

  const previewItem = useMemo(() => {
    if (!album) return null;
    return album[Math.min(activeIndex, album.length - 1)];
  }, [album, activeIndex]);

  const albumCaption = useMemo(() => {
    if (!album) return null;
    for (const it of album) {
      if (typeof it.content === 'string' && it.content.trim().length > 0) return it.content;
    }
    return null;
  }, [album]);

  useEffect(() => {
    // Avoid flashing a full-screen Loading overlay when switching within an album.
    if (!detail) setLoading(true);
    fetchItemDetail(currentItemId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentItemId]);

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
  const goPrev = () => {
    if (!album) return;
    setActiveIndex((prev) => (prev - 1 + album.length) % album.length);
  };
  const goNext = () => {
    if (!album) return;
    setActiveIndex((prev) => (prev + 1) % album.length);
  };

  if (loading && !detail) return <div className="modal-overlay"><div className="modal-loading">Loading...</div></div>;
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
              {(previewItem?.s3_url || detail.s3_url) && (
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
              )}

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
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveIndex(i);
                        }}
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
