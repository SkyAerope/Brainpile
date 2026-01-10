import React, { useRef, useState, useEffect } from 'react';
import { fetchEntities, Item, Entity } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';

export const EntitiesPage: React.FC = () => {
    const [entities, setEntities] = useState<Entity[]>([]);
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

    const requestSeqRef = useRef(0);
    const activeRequestRef = useRef<AbortController | null>(null);

    useEffect(() => {
        fetchEntities().then(data => {
            setEntities(data);
            // 移除默认选中第一个的逻辑
        });
    }, []);

    const loadEntityItems = async (id: string) => {
        // 如果点击已选中的，则取消选中
        if (selectedEntityId === id) {
            requestSeqRef.current += 1;
            activeRequestRef.current?.abort();
            activeRequestRef.current = null;
            setSelectedEntityId(null);
            setItems([]);
            setCursor(null);
            return;
        }

        const requestSeq = (requestSeqRef.current += 1);
        activeRequestRef.current?.abort();
        const controller = new AbortController();
        activeRequestRef.current = controller;

        setLoading(true);
        setSelectedEntityId(id);
        setItems([]); // 切换时先清空
        setCursor(null);
        try {
            const res = await fetch(`/api/v1/items?entity_id=${id}`, { signal: controller.signal });
            if (res.ok) {
                const data = await res.json();

                if (requestSeqRef.current !== requestSeq) return;
                setItems(data.items);
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

    const loadMore = async () => {
        if (!selectedEntityId || loading || !cursor) return;

        const entityId = selectedEntityId;
        const cursorSnapshot = cursor;
        const requestSeq = (requestSeqRef.current += 1);
        activeRequestRef.current?.abort();
        const controller = new AbortController();
        activeRequestRef.current = controller;

        setLoading(true);
        try {
            const res = await fetch(`/api/v1/items?entity_id=${entityId}&cursor=${cursorSnapshot}`, { signal: controller.signal });
            if (res.ok) {
                const data = await res.json();

                if (requestSeqRef.current !== requestSeq) return;
                // Ensure we still show the same entity's items
                if (entityId !== selectedEntityId) return;
                setItems(prev => [...prev, ...data.items]);
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

    return (
        <div className="entities-page-layout">
            <div className="entities-drawer">
                <div className="drawer-header">
                    <h2>Entities</h2>
                </div>
                <div className="entities-list">
                    {entities.map(entity => (
                        <div 
                            key={entity.id} 
                            className={`entity-item ${selectedEntityId === entity.id ? 'active' : ''}`}
                            onClick={() => loadEntityItems(entity.id)}
                        >
                            <div className="entity-avatar">
                                {entity.id === '0' ? (
                                    <div className="avatar-placeholder" style={{ background: '#f0f0f0' }}>?</div>
                                ) : entity.avatar_url ? (
                                    <img src={entity.avatar_url} alt={entity.name} />
                                ) : (
                                    <div className="avatar-placeholder">{entity.name[0]}</div>
                                )}
                            </div>
                            <div className="entity-info">
                                <div className="entity-name">{entity.name}</div>
                                <div className="entity-meta">
                                    {entity.id === '0' ? 'Forwards from hidden profiles' :
                                     `@${entity.username || entity.type}`}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="entities-content">
                <div className="container">
                    {!selectedEntityId ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#71717a' }}>
                            Select an entity to view items
                        </div>
                    ) : (
                        <MasonryGrid 
                            items={items} 
                            layoutKey={selectedEntityId}
                            onItemClick={(item) => setSelectedItemId(item.id)} 
                            onItemDelete={(id) => setItems((prev) => prev.filter((it) => it.id !== id))}
                            loading={loading}
                            hasMore={!!cursor}
                            onLoadMore={loadMore}
                        />
                    )}
                </div>
            </div>

            {selectedItemId && (
                <ItemModal 
                    itemId={selectedItemId} 
                    onClose={() => setSelectedItemId(null)}
                    onDeleted={(id) => {
                        setItems((prev) => prev.filter((it) => it.id !== id));
                        setSelectedItemId(null);
                    }}
                />
            )}
        </div>
    );
};
