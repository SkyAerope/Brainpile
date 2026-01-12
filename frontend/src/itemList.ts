import { Item } from './api';

export function uniqueItemsById(items: Item[]): Item[] {
  const seen = new Set<number>();
  const out: Item[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

export function mergeUniqueItemsById(prev: Item[], next: Item[]): Item[] {
  if (prev.length === 0) return uniqueItemsById(next);
  if (next.length === 0) return prev;

  const seen = new Set<number>();
  const out: Item[] = [];

  for (const item of prev) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}
