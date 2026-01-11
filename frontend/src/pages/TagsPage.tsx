import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { deleteTag, fetchItems, fetchTags, type Item, type Tag, updateTagLabel } from '../api';
import { MasonryGrid } from '../components/MasonryGrid';
import { ItemModal } from '../components/ItemModal';
import { TagIcon } from '../components/TagIcon';
import { ConfirmModal } from '../components/ConfirmModal';

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

export const TagsPage: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const tagsRequestSeqRef = useRef(0);
  const tagsActiveRequestRef = useRef<AbortController | null>(null);

  const itemsRequestSeqRef = useRef(0);
  const itemsActiveRequestRef = useRef<AbortController | null>(null);

  const [editLabel, setEditLabel] = useState<string>('');
  const [editBusy, setEditBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { ref: tagsListRef, width: tagsListWidth, height: tagsListHeight } = useElementSize<HTMLDivElement>();

  const selectedTag = useMemo(() => tags.find((t) => t.id === selectedTagId) ?? null, [tags, selectedTagId]);

  const reloadTags = useCallback(async () => {
    const requestSeq = (tagsRequestSeqRef.current += 1);
    tagsActiveRequestRef.current?.abort();
    const controller = new AbortController();
    tagsActiveRequestRef.current = controller;

    setTagsLoading(true);
    try {
      const data = await fetchTags(controller.signal);
      if (tagsRequestSeqRef.current !== requestSeq) return;
      setTags(data);
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') console.error(e);
    } finally {
      if (tagsRequestSeqRef.current === requestSeq) setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadTags();
    return () => tagsActiveRequestRef.current?.abort();
  }, [reloadTags]);

  useEffect(() => {
    setEditLabel(selectedTag?.label ?? '');
  }, [selectedTag?.id]);

  const loadTagItems = useCallback(async (id: number) => {
    // toggle off
    if (selectedTagId === id) {
      itemsRequestSeqRef.current += 1;
      itemsActiveRequestRef.current?.abort();
      itemsActiveRequestRef.current = null;
      setSelectedTagId(null);
      setItems([]);
      setCursor(null);
      setSelectedItemId(null);
      return;
    }

    const requestSeq = (itemsRequestSeqRef.current += 1);
    itemsActiveRequestRef.current?.abort();
    const controller = new AbortController();
    itemsActiveRequestRef.current = controller;

    setItemsLoading(true);
    setSelectedTagId(id);
    setItems([]);
    setCursor(null);
    setSelectedItemId(null);

    try {
      const data = await fetchItems(null, 'timeline', null, id, controller.signal);
      if (itemsRequestSeqRef.current !== requestSeq) return;
      setItems(data.items);
      setCursor(data.next_cursor);
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') console.error(e);
    } finally {
      if (itemsRequestSeqRef.current === requestSeq) setItemsLoading(false);
    }
  }, [selectedTagId]);

  const loadMore = useCallback(async () => {
    if (!selectedTagId || itemsLoading || !cursor) return;

    const tagId = selectedTagId;
    const cursorSnapshot = cursor;

    const requestSeq = (itemsRequestSeqRef.current += 1);
    itemsActiveRequestRef.current?.abort();
    const controller = new AbortController();
    itemsActiveRequestRef.current = controller;

    setItemsLoading(true);
    try {
      const data = await fetchItems(cursorSnapshot, 'timeline', null, tagId, controller.signal);
      if (itemsRequestSeqRef.current !== requestSeq) return;
      if (tagId !== selectedTagId) return;
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.next_cursor);
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') console.error(e);
    } finally {
      if (itemsRequestSeqRef.current === requestSeq) setItemsLoading(false);
    }
  }, [cursor, itemsLoading, selectedTagId]);

  type TagRowProps = {
    tags: Tag[];
    selectedTagId: number | null;
    onSelectTag: (id: number) => void;
  };

  const TagRow = ({ ariaAttributes, index, style, tags: rowTags, selectedTagId: rowSelectedTagId, onSelectTag }: RowComponentProps<TagRowProps>): React.ReactElement => {
    const tag = rowTags[index];
    if (!tag) return <div style={style} {...ariaAttributes} />;

    return (
      <div style={style} {...ariaAttributes}>
        <div style={{ padding: '0 12px', paddingBottom: '4px' }}>
          <div className={`entity-item ${rowSelectedTagId === tag.id ? 'active' : ''}`} onClick={() => onSelectTag(tag.id)}>
            <div className="entity-avatar">
              <TagIcon tag={tag} size={22} title={tag.label ?? undefined} />
            </div>
            <div className="entity-info">
              <div className="entity-header-row">
                <div className="entity-name">{tag.label?.trim() ? tag.label : '(no label)'}</div>
              </div>
              <div className="entity-meta">
                {tag.icon_type === 'emoji' ? `emoji: ${tag.icon_value}` : `tmoji: ${tag.icon_value}`}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const tagRowProps = useMemo<TagRowProps>(() => ({ tags, selectedTagId, onSelectTag: loadTagItems }), [tags, selectedTagId, loadTagItems]);

  const handleSaveLabel = useCallback(async () => {
    if (!selectedTag) return;
    if (editBusy) return;

    const nextLabel = editLabel.trim();
    setEditBusy(true);
    try {
      await updateTagLabel(selectedTag.id, nextLabel ? nextLabel : null);
      await reloadTags();
    } catch (e) {
      console.error(e);
    } finally {
      setEditBusy(false);
    }
  }, [editBusy, editLabel, reloadTags, selectedTag]);

  const handleDeleteTag = useCallback(async () => {
    if (!selectedTag) return;
    try {
      await deleteTag(selectedTag.id);
      setShowDeleteConfirm(false);
      setSelectedTagId(null);
      setItems([]);
      setCursor(null);
      setSelectedItemId(null);
      await reloadTags();
    } catch (e) {
      console.error(e);
    }
  }, [reloadTags, selectedTag]);

  return (
    <div className="entities-page-layout">
      <div className="entities-drawer">
        <div className="drawer-header">
          <h2>
            Tags <span style={{ color: '#767676', fontWeight: 500, fontSize: '14px' }}>({tags.length})</span>
          </h2>
        </div>

        <div className="entities-list" ref={tagsListRef}>
          {tagsListHeight > 0 && tagsListWidth > 0 && (
            <List<TagRowProps>
              defaultHeight={tagsListHeight}
              rowCount={tags.length}
              rowHeight={76}
              overscanCount={6}
              rowComponent={TagRow}
              rowProps={tagRowProps}
              style={{ height: tagsListHeight, width: tagsListWidth }}
            />
          )}
          {!tagsLoading && tags.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-secondary)' }}>No tags yet</div>
          )}
        </div>
      </div>

      <div className="entities-content">
        <div className="container">
          {!selectedTag ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#71717a' }}>
              Select a tag to view items
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0 16px 0' }}>
                <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TagIcon tag={selectedTag} size={22} title={selectedTag.label ?? undefined} />
                </div>

                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="label"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-color)',
                    background: '#efefef',
                    outline: 'none',
                  }}
                />

                <button className="btn" onClick={handleSaveLabel} disabled={editBusy}>
                  Save
                </button>

                <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(true)}>
                  Delete
                </button>
              </div>

              <MasonryGrid
                items={items}
                layoutKey={`tag:${selectedTag.id}`}
                onItemClick={(item) => setSelectedItemId(item.id)}
                onItemDelete={(id) => setItems((prev) => prev.filter((it) => it.id !== id))}
                loading={itemsLoading}
                hasMore={!!cursor}
                onLoadMore={loadMore}
              />
            </>
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

      {showDeleteConfirm && selectedTag && (
        <ConfirmModal
          title="Delete Tag"
          message={`Delete tag "${selectedTag.label?.trim() ? selectedTag.label : selectedTag.icon_value}"? This does not edit existing items yet.`}
          confirmLabel="Delete"
          isDanger
          onConfirm={handleDeleteTag}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
};
