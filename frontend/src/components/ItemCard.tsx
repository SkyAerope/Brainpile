import React from 'react';
import { Item } from '../api';
import './ItemCard.css';
import { Maximize2, Image as ImageIcon } from 'lucide-react';

interface Props {
  item: Item;
  onClick: (item: Item) => void;
}

export const ItemCard: React.FC<Props> = ({ item, onClick }) => {
  const aspectRatio = item.width && item.height ? item.width / item.height : undefined;
  
  return (
    <div className="item-card" onClick={() => onClick(item)}>
      {item.type !== 'text' && (
        <div 
            className="item-media" 
            style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
        >
          {item.s3_url && (item.type === 'image' || item.type === 'video') ? (
            <img 
                src={item.type === 'video' ? item.thumbnail_url || item.s3_url : item.s3_url} 
                alt="content" 
                loading="lazy" 
            />
          ) : (
            <div className="placeholder">
              <ImageIcon size={48} />
            </div>
          )}
          <div className="overlay">
            <Maximize2 className="icon" size={24} />
          </div>
        </div>
      )}
      <div className="item-content">
        <div className="item-meta">
            <span className="type-badge">{item.type}</span>
            <span className="date">{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Unknown'}</span>
        </div>
        {item.content && <p className="text-preview">{item.content}</p>}
      </div>
    </div>
  );
};
