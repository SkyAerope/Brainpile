export interface Item {
  id: number;
  // Client-only stable key for UI lists (e.g. Random page may contain duplicate ids).
  // Not persisted; may be undefined for most items.
  clientKey?: string;
  type: string;
  content: string | null;
  s3_url: string | null;
  thumbnail_url?: string | null;
  created_at: string | null;
  width?: number;
  height?: number;
  source_url?: string | null;
  tg_group_id?: string | null;
  group_items?: Item[];
  tags?: number[];
  tag_objects?: Tag[];
}

export interface Tag {
  id: number;
  icon_type: string;
  icon_value: string;
  label?: string | null;
  asset_url?: string | null;
  asset_mime?: string | null;
}

export interface ItemDetail extends Item {
  searchable_text: string | null;
  tg_link: string | null;
  processed_at: string | null;
  meta: Record<string, any>;
  tags: number[];
}

export interface Entity {
  id: string; // BIGINT as string for JS safety, or "unknown"
  name: string;
  username: string | null;
  type: string;
  avatar_url: string | null;
  updated_at?: string | null;
}

export interface EntitiesPageResponse {
  entities: Entity[];
  next_cursor: string | null;
  total: number;
}

export interface ListResponse {
  items: Item[];
  next_cursor: number | null;
}

type InflightJsonEntry<T> = {
  promise: Promise<T>;
};

const inflightGetJson = new Map<string, InflightJsonEntry<any>>();

function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError') || (err as any)?.name === 'AbortError';
}

function makeAbortError(): Error {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const err = new Error('Aborted');
    (err as any).name = 'AbortError';
    return err;
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };

    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {
        // ignore
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  });
}

function sharedGetJson<T>(url: string, consumerSignal?: AbortSignal): Promise<T> {
  const existing = inflightGetJson.get(url) as InflightJsonEntry<T> | undefined;
  if (existing) {
    return abortable(existing.promise, consumerSignal);
  }

  const entry: InflightJsonEntry<T> = {
    promise: Promise.resolve(undefined as any) as Promise<T>,
  };

  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json() as Promise<T>;
    })
    .finally(() => {
      inflightGetJson.delete(url);
    });

  entry.promise = promise;
  inflightGetJson.set(url, entry);
  return abortable(promise, consumerSignal);
}

export async function fetchItems(
  cursor?: number | null,
  mode: 'timeline' | 'random' = 'timeline',
  entity_id?: string | null,
  tag_id?: number | null,
  signal?: AbortSignal
): Promise<ListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor.toString());
  if (mode) params.append('mode', mode);
  if (entity_id) params.append('entity_id', entity_id);
  if (tag_id) params.append('tag_id', tag_id.toString());
  
  const url = `/api/v1/items?${params.toString()}`;
  try {
    return await sharedGetJson<ListResponse>(url, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('Failed to fetch items');
  }
}

export async function fetchItemDetail(id: number): Promise<ItemDetail> {
  const url = `/api/v1/items/${id}`;
  try {
    return await sharedGetJson<ItemDetail>(url);
  } catch {
    throw new Error('Failed to fetch item detail');
  }
}

export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`/api/v1/items/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete item');
}

export async function fetchEntitiesPage(
  cursor?: string | null,
  limit: number = 10,
  signal?: AbortSignal
): Promise<EntitiesPageResponse> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  params.append('limit', String(limit));

  const url = `/api/v1/entities?${params.toString()}`;
  try {
    return await sharedGetJson<EntitiesPageResponse>(url, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('Failed to fetch entities');
  }
}

// Back-compat helper: returns a flat list. Prefer fetchEntitiesPage() for pagination.
export async function fetchEntities(signal?: AbortSignal): Promise<Entity[]> {
  const page = await fetchEntitiesPage(null, 1000, signal);
  return page.entities;
}

export interface SearchResponse {
  items: Item[];
  total: number;
}

export async function searchItems(query: string, type?: string, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.append('q', query);
  if (type) params.append('type', type);
  
  const url = `/api/v1/search?${params.toString()}`;
  try {
    return await sharedGetJson<SearchResponse>(url, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('Failed to search items');
  }
}

export async function fetchTags(signal?: AbortSignal): Promise<Tag[]> {
  try {
    const data = await sharedGetJson<{ tags?: Tag[] }>('/api/v1/tags', signal);
    return (data.tags || []) as Tag[];
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('Failed to fetch tags');
  }
}

export async function createTag(
  payload: { icon_type: 'emoji' | 'tmoji'; icon_value: string; label?: string | null },
  signal?: AbortSignal
): Promise<{ id: number }> {
  const res = await fetch('/api/v1/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error('Failed to create tag');
  return res.json();
}

export async function updateTagLabel(id: number, label: string | null, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api/v1/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
    signal,
  });
  if (!res.ok) throw new Error('Failed to update tag');
}

export async function deleteTag(id: number, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api/v1/tags/${id}`, { method: 'DELETE', signal });
  if (!res.ok) throw new Error('Failed to delete tag');
}
