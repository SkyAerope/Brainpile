import React, { useMemo, useState, useEffect } from 'react';
import { fetchItems, Item } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';
import { groupItemsForGrid } from '../groupItems';

export const RandomPage: React.FC = () => {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [selected, setSelected] = useState<{
        itemId: number;
        groupItems?: Item[];
        startIndex?: number;
    } | null>(null);

    const groupedItems = useMemo(() => groupItemsForGrid(items), [items]);

    const load = async () => {
        if (loading || !hasMore) return;
        setLoading(true);
        try {
            const data = await fetchItems(null, 'random');
            if (data.items.length === 0) {
                setHasMore(false);
                return;
            }

            // 允许重复：只要接口返回了数据，就直接追加展示。
            setItems((prev) => [...prev, ...data.items]);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="container">
            <MasonryGrid 
                items={groupedItems} 
                layoutKey={'random'}
                onItemClick={(item, opts) => setSelected({ itemId: item.id, groupItems: item.group_items, startIndex: opts?.startIndex })} 
                onItemDelete={(id) => setItems((prev) => prev.filter((it) => it.id !== id))}
                loading={loading}
                hasMore={hasMore}
                onLoadMore={() => load()}
            />
            {selected && (
                <ItemModal 
                    itemId={selected.itemId} 
                    groupItems={selected.groupItems}
                    startIndex={selected.startIndex}
                    onClose={() => setSelected(null)}
                    onDeleted={(id) => {
                        setItems((prev) => prev.filter((it) => it.id !== id));
                        setSelected(null);
                    }}
                />
            )}
        </div>
    );
};
