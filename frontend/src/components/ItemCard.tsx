import React, { useState, useRef, useEffect } from 'react';
import { Item, deleteItem } from '../api';
import './ItemCard.css';
import { ExternalLink, Image as ImageIcon, MoreHorizontal, Download, Trash2, Send } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  item: Item;
  onClick: (item: Item) => void;
  onDeleted?: (id: number) => void;
}

export const ItemCard: React.FC<Props> = ({ item, onClick, onDeleted }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const aspectRatio = item.width && item.height ? item.width / item.height : undefined;

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
    } catch (e) {
      alert('Failed to delete item');
    }
  };
  
  return (
    <div className={`item-card type-${item.type}`} onClick={() => onClick(item)}>
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
      {item.type === 'text' ? (
        <div className="item-media-placeholder">
           <p className="text-title">{item.content}</p>
        </div>
      ) : (
        <div 
            className="item-media" 
            style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
        >
          {item.s3_url && (item.type === 'image' || item.type === 'video') ? (
            <img 
                src={item.thumbnail_url || item.s3_url} 
                alt="content" 
                loading="lazy" 
            />
          ) : (
            <div className="placeholder">
              <ImageIcon size={48} />
            </div>
          )}
          <div className="overlay">
            <button className="view-btn">
                View
            </button>
            {item.source_url && (
                <a 
                    href={item.source_url} 
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
        {item.type !== 'text' && item.content && <p className="text-title">{item.content}</p>}
        <div className="item-meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <span className="type-badge">{item.type}</span>
                <span className="date">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
            </div>
            <div className="item-more-container" ref={menuRef} onClick={(e) => e.stopPropagation()}>
                <button 
                  className="more-btn"
                  onClick={() => setShowMenu(!showMenu)}
                >
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
