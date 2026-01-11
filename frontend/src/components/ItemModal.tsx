import React, { useEffect, useState } from 'react';
import { ItemDetail, fetchItemDetail, deleteItem } from '../api';
import './ItemModal.css';
import { X, Trash2, ExternalLink, Calendar, FileText, Image as ImageIcon, Download } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { TagIcon } from './TagIcon';

interface Props {
  itemId: number;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

export const ItemModal: React.FC<Props> = ({ itemId, onClose, onDeleted }) => {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetchItemDetail(itemId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [itemId]);

  const handleDelete = async () => {
    try {
      await deleteItem(itemId);
      onDeleted(itemId);
      onClose();
    } catch (e) {
      alert('Failed to delete item');
    }
  };

  if (loading) return <div className="modal-overlay"><div className="modal-loading">Loading...</div></div>;
  if (!detail) return null;

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
                 {detail.s3_url && (
                    detail.type === 'video' ? (
                        <video controls src={detail.s3_url} className="modal-media" />
                    ) : (detail.type === 'image' ? (
                        <img src={detail.s3_url} alt="Full content" className="modal-media" />
                    ) : null)
                 ) || (
                    <div className="modal-placeholder">
                         {detail.type === 'text' ? <FileText size={64} /> : <ImageIcon size={64} />}
                         <p>No Media Preview</p>
                    </div>
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
                    <p className="content-text">{detail.content || 'No content'}</p>
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
                    <a href={`/api/v1/items/${detail.id}/raw`} target="_blank" className="btn btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
