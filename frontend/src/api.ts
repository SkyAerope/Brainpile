export interface Item {
  id: number;
  type: string;
  content: string | null;
  s3_url: string | null;
  thumbnail_url?: string | null;
  created_at: string | null;
  width?: number;
  height?: number;
  source_url?: string | null;
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

export async function fetchItems(
  cursor?: number | null,
  mode: 'timeline' | 'random' = 'timeline',
  entity_id?: string | null,
  signal?: AbortSignal
): Promise<ListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor.toString());
  if (mode) params.append('mode', mode);
  if (entity_id) params.append('entity_id', entity_id);
  
  const res = await fetch(`/api/v1/items?${params.toString()}`, { signal });
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}

export async function fetchItemDetail(id: number): Promise<ItemDetail> {
  const res = await fetch(`/api/v1/items/${id}`);
  if (!res.ok) throw new Error('Failed to fetch item detail');
  return res.json();
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

  const res = await fetch(`/api/v1/entities?${params.toString()}`, { signal });
  if (!res.ok) throw new Error('Failed to fetch entities');
  return res.json();
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
  
  const res = await fetch(`/api/v1/search?${params.toString()}`, { signal });
  if (!res.ok) throw new Error('Failed to search items');
  return res.json();
}
