import React from 'react';
import { Item } from '../api';
import './ItemCard.css';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';

interface Props {
  item: Item;
  onClick: (item: Item) => void;
}

export const ItemCard: React.FC<Props> = ({ item, onClick }) => {
  const aspectRatio = item.width && item.height ? item.width / item.height : undefined;
  
  return (
    <div className={`item-card type-${item.type}`} onClick={() => onClick(item)}>
      {item.type !== 'text' && (
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
        {item.content && <p className="text-title">{item.content}</p>}
        <div className="item-meta">
            <span className="type-badge">{item.type}</span>
            <span className="date">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
        </div>
      </div>
    </div>
  );
};
