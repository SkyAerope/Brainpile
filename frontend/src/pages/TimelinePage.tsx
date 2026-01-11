import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchItems, searchItems, Item } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';
import { groupItemsForGrid } from '../groupItems';

export const TimelinePage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const query = searchParams.get('search');
    
    const [items, setItems] = useState<Item[]>([]);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<{
        itemId: number;
        groupItems?: Item[];
        startIndex?: number;
    } | null>(null);

    const requestSeqRef = useRef(0);
    const activeRequestRef = useRef<AbortController | null>(null);

    const load = async (reset = false) => {
        if (loading && !reset) return;
        const requestSeq = (requestSeqRef.current += 1);
        activeRequestRef.current?.abort();
        const controller = new AbortController();
        activeRequestRef.current = controller;

        setLoading(true);
        try {
            if (query) {
                // Search mode
                if (reset) {
                    const data = await searchItems(query, undefined, controller.signal);

                    if (requestSeqRef.current !== requestSeq) return;
                    setItems(data.items);
                    setCursor(null);
                }
            } else {
                // Normal timeline
                const cursorSnapshot = reset ? null : cursor;
                const data = await fetchItems(cursorSnapshot, 'timeline', undefined, null, controller.signal);

                if (requestSeqRef.current !== requestSeq) return;
                setItems(prev => reset ? data.items : [...prev, ...data.items]);
                setCursor(data.next_cursor);
            }
        } catch (e) { 
            if ((e as any)?.name !== 'AbortError') {
                console.error(e);
            }
        } finally { 
            if (requestSeqRef.current === requestSeq) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        // Ensure we don't show stale results or keep stale pagination state
        // when toggling between search and timeline.
        setItems([]);
        setCursor(null);
        setSelected(null);
        void load(true);
    }, [query]);

    const groupedItems = useMemo(() => groupItemsForGrid(items), [items]);

    return (
        <div className="container">
            {query && (
                <div style={{ padding: '16px 0', color: 'var(--text-secondary)' }}>
                    Searching for: <strong>{query}</strong> ({items.length} 结果)
                </div>
            )}
            <MasonryGrid 
                items={groupedItems} 
                layoutKey={query ?? 'timeline'}
                onItemClick={(item, opts) => setSelected({ itemId: item.id, groupItems: item.group_items, startIndex: opts?.startIndex })} 
                onItemDelete={(id) => setItems((prev) => prev.filter((it) => it.id !== id))}
                loading={loading}
                hasMore={!query && !!cursor}
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
