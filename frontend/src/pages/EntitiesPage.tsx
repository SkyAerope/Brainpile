import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { fetchEntitiesPage, Item, Entity } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';
import { groupItemsForGrid } from '../groupItems';

function formatEntityUpdatedAt(updatedAt?: string | null): string {
    if (!updatedAt) return '';
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString();
}

function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setSize({ width: Math.floor(width), height: Math.floor(height) });
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return { ref, ...size };
}

type EntitiesRowProps = {
    entities: Entity[];
    selectedEntityId: string | null;
    onSelectEntity: (id: string) => void;
};

const EntityRow = ({
    ariaAttributes,
    index,
    style,
    entities: rowEntities,
    selectedEntityId: rowSelectedEntityId,
    onSelectEntity,
}: RowComponentProps<EntitiesRowProps>): React.ReactElement => {
    const entity = rowEntities[index];

    if (!entity) {
        return <div style={style} {...ariaAttributes} />;
    }

    return (
        <div style={style} {...ariaAttributes}>
            <div style={{ padding: '0 12px', paddingBottom: '4px' }}>
                <div
                    className={`entity-item ${rowSelectedEntityId === entity.id ? 'active' : ''}`}
                    onClick={() => onSelectEntity(entity.id)}
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
                        <div className="entity-header-row">
                            <div className="entity-name">{entity.name}</div>
                            <div className="entity-updated-at">{formatEntityUpdatedAt(entity.updated_at)}</div>
                        </div>
                        <div className="entity-meta">
                            {entity.id === '0'
                                ? 'Forwards from hidden profiles'
                                : `@${entity.username || entity.type}`}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const EntitiesPage: React.FC = () => {
    const [entities, setEntities] = useState<Entity[]>([]);
    const [entitiesTotal, setEntitiesTotal] = useState<number>(0);
    const [entitiesCursor, setEntitiesCursor] = useState<string | null>(null);
    const [entitiesLoading, setEntitiesLoading] = useState(false);
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<{
        itemId: number;
        groupItems?: Item[];
        startIndex?: number;
    } | null>(null);

    const groupedItems = useMemo(() => groupItemsForGrid(items), [items]);

    const itemsRequestSeqRef = useRef(0);
    const itemsActiveRequestRef = useRef<AbortController | null>(null);

    const entitiesRequestSeqRef = useRef(0);
    const entitiesActiveRequestRef = useRef<AbortController | null>(null);

    const { ref: entitiesListRef, width: entitiesListWidth, height: entitiesListHeight } = useElementSize<HTMLDivElement>();

    useEffect(() => {
        const controller = new AbortController();
        const requestSeq = (entitiesRequestSeqRef.current += 1);
        entitiesActiveRequestRef.current?.abort();
        entitiesActiveRequestRef.current = controller;

        setEntitiesLoading(true);
        fetchEntitiesPage(null, 10, controller.signal)
            .then((data) => {
                if (entitiesRequestSeqRef.current !== requestSeq) return;
                setEntities(data.entities);
                setEntitiesCursor(data.next_cursor);
                setEntitiesTotal(data.total);
            })
            .catch((e) => {
                if ((e as any)?.name !== 'AbortError') console.error(e);
            })
            .finally(() => {
                if (entitiesRequestSeqRef.current === requestSeq) setEntitiesLoading(false);
            });

        return () => controller.abort();
    }, []);

    const loadMoreEntities = useCallback(async () => {
        if (entitiesLoading) return;
        if (!entitiesCursor) return;

        const requestSeq = (entitiesRequestSeqRef.current += 1);
        entitiesActiveRequestRef.current?.abort();
        const controller = new AbortController();
        entitiesActiveRequestRef.current = controller;

        setEntitiesLoading(true);
        try {
            const data = await fetchEntitiesPage(entitiesCursor, 10, controller.signal);
            if (entitiesRequestSeqRef.current !== requestSeq) return;

            setEntities((prev) => [...prev, ...data.entities]);
            setEntitiesCursor(data.next_cursor);
            setEntitiesTotal(data.total);
        } catch (e) {
            if ((e as any)?.name !== 'AbortError') {
                console.error(e);
            }
        } finally {
            if (entitiesRequestSeqRef.current === requestSeq) {
                setEntitiesLoading(false);
            }
        }
    }, [entitiesCursor, entitiesLoading]);

    const loadEntityItems = useCallback(
        async (id: string) => {
            // 如果点击已选中的，则取消选中
            if (selectedEntityId === id) {
                itemsRequestSeqRef.current += 1;
                itemsActiveRequestRef.current?.abort();
                itemsActiveRequestRef.current = null;
                setSelectedEntityId(null);
                setItems([]);
                setCursor(null);
                return;
            }

            const requestSeq = (itemsRequestSeqRef.current += 1);
            itemsActiveRequestRef.current?.abort();
            const controller = new AbortController();
            itemsActiveRequestRef.current = controller;

            setLoading(true);
            setSelectedEntityId(id);
            setItems([]); // 切换时先清空
            setCursor(null);
            setSelected(null);
            try {
                const res = await fetch(`/api/v1/items?entity_id=${id}` , { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json();

                    if (itemsRequestSeqRef.current !== requestSeq) return;
                    setItems(data.items);
                    setCursor(data.next_cursor);
                }
            } catch (e) {
                if ((e as any)?.name !== 'AbortError') {
                    console.error(e);
                }
            } finally {
                if (itemsRequestSeqRef.current === requestSeq) {
                    setLoading(false);
                }
            }
        },
        [selectedEntityId]
    );

    const entitiesRowProps = useMemo<EntitiesRowProps>(
        () => ({ entities, selectedEntityId, onSelectEntity: loadEntityItems }),
        [entities, selectedEntityId, loadEntityItems]
    );

    const loadMore = async () => {
        if (!selectedEntityId || loading || !cursor) return;

        const entityId = selectedEntityId;
        const cursorSnapshot = cursor;
        const requestSeq = (itemsRequestSeqRef.current += 1);
        itemsActiveRequestRef.current?.abort();
        const controller = new AbortController();
        itemsActiveRequestRef.current = controller;

        setLoading(true);
        try {
            const res = await fetch(`/api/v1/items?entity_id=${entityId}&cursor=${cursorSnapshot}`, { signal: controller.signal });
            if (res.ok) {
                const data = await res.json();

                if (itemsRequestSeqRef.current !== requestSeq) return;
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
            if (itemsRequestSeqRef.current === requestSeq) {
                setLoading(false);
            }
        }
    };

    return (
        <div className="entities-page-layout">
            <div className="entities-drawer">
                <div className="drawer-header">
                    <h2>
                        Entities <span style={{ color: '#767676', fontWeight: 500, fontSize: '14px' }}>({entitiesTotal || entities.length})</span>
                    </h2>
                </div>
                <div className="entities-list" ref={entitiesListRef}>
                    {entitiesListHeight > 0 && entitiesListWidth > 0 && (
                        <List<EntitiesRowProps>
                            defaultHeight={entitiesListHeight}
                            rowCount={entities.length}
                            rowHeight={76}
                            overscanCount={4}
                            onRowsRendered={(visibleRows) => {
                                const nearEnd = visibleRows.stopIndex >= entities.length - 4;
                                if (nearEnd && !!entitiesCursor && !entitiesLoading) {
                                    void loadMoreEntities();
                                }
                            }}
                            rowComponent={EntityRow}
                            rowProps={entitiesRowProps}
                            style={{ height: entitiesListHeight, width: entitiesListWidth }}
                        />
                    )}
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
                            items={groupedItems} 
                            layoutKey={selectedEntityId}
                            onItemClick={(item, opts) => setSelected({ itemId: item.id, groupItems: item.group_items, startIndex: opts?.startIndex })} 
                            onItemDelete={(id) => setItems((prev) => prev.filter((it) => it.id !== id))}
                            loading={loading}
                            hasMore={!!cursor}
                            onLoadMore={loadMore}
                        />
                    )}
                </div>
            </div>

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
