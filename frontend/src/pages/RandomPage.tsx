import React, { useState, useEffect } from 'react';
import { fetchItems, Item } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';

export const RandomPage: React.FC = () => {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

    const load = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const data = await fetchItems(null, 'random');
            setItems(prev => [...prev, ...data.items]);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="container">
            <MasonryGrid 
                items={items} 
                onItemClick={(item) => setSelectedItemId(item.id)} 
                onItemDelete={(id) => setItems(items.filter(it => it.id !== id))}
                loading={loading}
                hasMore={true}
                onLoadMore={() => load()}
            />
            {selectedItemId && (
                <ItemModal 
                    itemId={selectedItemId} 
                    onClose={() => setSelectedItemId(null)}
                    onDeleted={(id) => {
                        setItems(items.filter(it => it.id !== id));
                        setSelectedItemId(null);
                    }}
                />
            )}
        </div>
    );
};
