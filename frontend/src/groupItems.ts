import { Item } from './api';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function groupItemsForGrid(items: Item[]): Item[] {
  const groupMetaById = new Map<
    string,
    {
      index: number;
      caption: string | null;
      members: Item[];
    }
  >();

  const output: Item[] = [];

  const applyCaption = (it: Item, caption: string | null): Item => {
    if (!caption) return it;
    return {
      ...it,
      content: caption,
    };
  };

  for (const item of items) {
    const groupId = item.tg_group_id;
    if (!isNonEmptyString(groupId)) {
      output.push(item);
      continue;
    }

    const incomingCaption = isNonEmptyString(item.content) ? item.content : null;
    const meta = groupMetaById.get(groupId);

    if (!meta) {
      const caption = incomingCaption;
      const member = applyCaption(item, caption);
      const groupItem: Item = {
        ...applyCaption(item, caption),
        group_items: [member],
      };
      groupMetaById.set(groupId, { index: output.length, caption, members: [member] });
      output.push(groupItem);
      continue;
    }

    const nextCaption = meta.caption ?? incomingCaption;
    let nextMembers = meta.members;

    if (!meta.members.some((m) => m.id === item.id)) {
      nextMembers = [...meta.members, applyCaption(item, nextCaption)];
    }

    if (nextCaption !== meta.caption) {
      nextMembers = nextMembers.map((m) => applyCaption(m, nextCaption));
    }

    const existing = output[meta.index];
    output[meta.index] = {
      ...applyCaption(existing, nextCaption),
      group_items: nextMembers,
    };

    groupMetaById.set(groupId, { index: meta.index, caption: nextCaption, members: nextMembers });
  }

  return output;
}
