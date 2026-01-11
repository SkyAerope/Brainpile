import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { Pencil, Trash2 } from 'lucide-react';
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

type TagRowProps = {
  tags: Tag[];
  selectedTagId: number | null;
  onSelectTag: (id: number) => void;
  editingTagId: number | null;
  editLabel: string;
  setEditingTagId: (id: number | null) => void;
  setEditLabel: (label: string) => void;
  handleSaveLabel: () => void;
  setTagToDelete: (tag: Tag | null) => void;
  setShowDeleteConfirm: (show: boolean) => void;
};

const TagRow = ({
  ariaAttributes,
  index,
  style,
  tags: rowTags,
  selectedTagId: rowSelectedTagId,
  onSelectTag,
  editingTagId: rowEditingTagId,
  editLabel: rowEditLabel,
  setEditingTagId: rowSetEditingTagId,
  setEditLabel: rowSetEditLabel,
  handleSaveLabel: rowHandleSaveLabel,
  setTagToDelete: rowSetTagToDelete,
  setShowDeleteConfirm: rowSetShowDeleteConfirm,
}: RowComponentProps<TagRowProps>): React.ReactElement => {
  const tag = rowTags[index];
  if (!tag) return <div style={style} {...ariaAttributes} />;

  const isEditing = rowEditingTagId === tag.id;

  return (
    <div style={style} {...ariaAttributes}>
      <div style={{ padding: '0 12px', paddingBottom: '4px' }}>
        <div
          className={`entity-item ${rowSelectedTagId === tag.id ? 'active' : ''}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if (isEditing) return;

            // When an input is active, mouse down happens before input blur.
            // Selecting here avoids the click being lost due to re-render during save.
            if (rowEditingTagId !== null) {
              rowHandleSaveLabel();
            }
            onSelectTag(tag.id);
          }}
        >
          <div className="entity-avatar">
            <TagIcon tag={tag} size={22} title={tag.label ?? undefined} />
          </div>
          <div className="entity-info">
            <div className="entity-header-row">
              {isEditing ? (
                <input
                  autoFocus
                  value={rowEditLabel}
                  onChange={(e) => rowSetEditLabel(e.target.value)}
                  onBlur={(e) => {
                    // 只有当焦点离开到非 entity-item 的地方时才这里处理
                    // 否则让 entity-item 的 onMouseDown 处理，避免竞争
                    const relatedTarget = e.relatedTarget as HTMLElement;
                    if (!relatedTarget?.closest('.entity-item')) {
                      rowHandleSaveLabel();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rowHandleSaveLabel();
                    if (e.key === 'Escape') rowSetEditingTagId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="inline-edit-input"
                />
              ) : (
                <div className="entity-name">{tag.label?.trim() ? tag.label : '(no label)'}</div>
              )}
            </div>
            <div className="entity-meta">
              {tag.icon_type === 'emoji' ? `emoji: ${tag.icon_value}` : `tmoji: ${tag.icon_value}`}
            </div>
          </div>

          {!isEditing && (
            <div className="entity-actions">
              <button
                className="entity-action-btn"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  rowSetEditingTagId(tag.id);
                  rowSetEditLabel(tag.label ?? '');
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="entity-action-btn danger"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  rowSetTagToDelete(tag);
                  rowSetShowDeleteConfirm(true);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
  const editBusyRef = useRef(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
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

  const handleSaveLabel = useCallback(async () => {
    if (editingTagId === null) return;
    if (editBusyRef.current) return;

    const tagToUpdate = tags.find((t) => t.id === editingTagId);
    if (!tagToUpdate) {
      setEditingTagId(null);
      return;
    }

    const nextLabel = editLabel.trim();
    if (nextLabel === (tagToUpdate.label ?? '')) {
      setEditingTagId(null);
      return;
    }

    editBusyRef.current = true;
    setEditBusy(true);
    const idToUpdate = tagToUpdate.id; // Capture locally
    try {
      await updateTagLabel(idToUpdate, nextLabel ? nextLabel : null);
      await reloadTags();
    } catch (e) {
      console.error(e);
    } finally {
      editBusyRef.current = false;
      setEditBusy(false);
      setEditingTagId((prev) => (prev === idToUpdate ? null : prev));
    }
  }, [editBusy, editLabel, reloadTags, editingTagId, tags]);

  const handleDeleteTag = useCallback(async () => {
    if (!tagToDelete) return;
    try {
      await deleteTag(tagToDelete.id);
      setShowDeleteConfirm(false);

      if (selectedTagId === tagToDelete.id) {
        setSelectedTagId(null);
        setItems([]);
        setCursor(null);
        setSelectedItemId(null);
      }
      setTagToDelete(null);
      await reloadTags();
    } catch (e) {
      console.error(e);
    }
  }, [reloadTags, tagToDelete, selectedTagId]);

  const tagRowProps = useMemo<TagRowProps>(
    () => ({
      tags,
      selectedTagId,
      onSelectTag: loadTagItems,
      editingTagId,
      editLabel,
      setEditingTagId,
      setEditLabel,
      handleSaveLabel,
      setTagToDelete,
      setShowDeleteConfirm,
    }),
    [
      tags,
      selectedTagId,
      loadTagItems,
      editingTagId,
      editLabel,
      setEditingTagId,
      setEditLabel,
      handleSaveLabel,
      setTagToDelete,
      setShowDeleteConfirm,
    ]
  );

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
              {/* 先注释掉，将来或许可以用在移动端ui？ */}
              {/* <div style={{ padding: '12px 0 16px 0', borderBottom: '1px solid var(--border-color)', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <TagIcon tag={selectedTag} size={24} />
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                    {selectedTag.label?.trim() ? selectedTag.label : selectedTag.icon_value}
                  </h1>
                </div>
              </div> */}

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

      {showDeleteConfirm && tagToDelete && (
        <ConfirmModal
          title="Delete Tag"
          message={`Delete tag "${tagToDelete.label?.trim() ? tagToDelete.label : tagToDelete.icon_value}"? This does not edit existing items yet.`}
          confirmLabel="Delete"
          isDanger
          onConfirm={handleDeleteTag}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setTagToDelete(null);
          }}
        />
      )}
    </div>
  );
};
