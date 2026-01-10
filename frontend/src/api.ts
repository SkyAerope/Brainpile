export interface Item {
  id: number;
  type: string;
  content: string | null;
  s3_url: string | null;
  created_at: string | null;
  width?: number;
  height?: number;
}

export interface ItemDetail extends Item {
  searchable_text: string | null;
  tg_link: string | null;
  processed_at: string | null;
  meta: Record<string, any>;
  tags: number[];
}

export interface ListResponse {
  items: Item[];
  next_cursor: number | null;
}

export async function fetchItems(cursor?: number | null, mode: 'timeline' | 'random' = 'timeline'): Promise<ListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor.toString());
  if (mode) params.append('mode', mode);
  
  const res = await fetch(`/api/v1/items?${params.toString()}`);
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
