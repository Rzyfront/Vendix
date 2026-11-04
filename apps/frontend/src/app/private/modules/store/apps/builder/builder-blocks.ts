import type {
  BuilderBlock,
  BuilderBlockDef,
  BuilderCatalog,
  BuilderListFieldDef,
  BuilderOperationMode,
} from './builder.types';

/**
 * F6-A — pure operations of the page builder. They never mutate their input
 * and return a new list, so the editor state stays a plain signal and every
 * operation is unit-testable without a component.
 */

/** Block types a page in `mode` may use (blocks without `modes` fit every mode). */
export function catalogForMode(catalog: BuilderCatalog, mode: BuilderOperationMode): BuilderBlockDef[] {
  return catalog.blocks.filter((def) => !def.modes || def.modes.includes(mode));
}

export function blockDef(catalog: BuilderCatalog, type: string): BuilderBlockDef | undefined {
  return catalog.blocks.find((def) => def.type === type);
}

/** Why a block cannot be added right now, or `null` when it can. */
export function addBlockBlocker(
  catalog: BuilderCatalog,
  blocks: readonly BuilderBlock[],
  type: string,
): string | null {
  const def = blockDef(catalog, type);
  if (!def) return 'Esta sección no existe en el catálogo de la app.';
  if (blocks.length >= catalog.maxBlocks) return `Máximo ${catalog.maxBlocks} secciones por página.`;
  if (def.single && blocks.some((b) => b.type === type)) return 'Ya está en la página: solo puede haber una.';
  return null;
}

/** A short id unique within `blocks` (`type_n`). */
export function newBlockId(type: string, blocks: readonly BuilderBlock[]): string {
  const taken = new Set(blocks.map((b) => b.id));
  let n = blocks.filter((b) => b.type === type).length + 1;
  while (taken.has(`${type}_${n}`)) n++;
  return `${type}_${n}`;
}

/** Inserts a new empty block of `type` at `index` (default: the end). */
export function insertBlock(
  blocks: readonly BuilderBlock[],
  type: string,
  index = blocks.length,
): { blocks: BuilderBlock[]; block: BuilderBlock } {
  const block: BuilderBlock = { id: newBlockId(type, blocks), type, props: {} };
  const at = Math.max(0, Math.min(index, blocks.length));
  return { blocks: [...blocks.slice(0, at), block, ...blocks.slice(at)], block };
}

/** Copies the block right below itself, with a new id and its own props. */
export function duplicateBlock(
  blocks: readonly BuilderBlock[],
  id: string,
): { blocks: BuilderBlock[]; block: BuilderBlock } | null {
  const index = blocks.findIndex((b) => b.id === id);
  if (index < 0) return null;
  const source = blocks[index];
  const block: BuilderBlock = {
    ...structuredClone(source),
    id: newBlockId(source.type, blocks),
  };
  return { blocks: [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)], block };
}

/** Moves the block from `from` to `to` (clamped); same list when nothing moves. */
export function moveBlock(blocks: readonly BuilderBlock[], from: number, to: number): BuilderBlock[] {
  const target = Math.max(0, Math.min(to, blocks.length - 1));
  if (from < 0 || from >= blocks.length || from === target) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

export function removeBlock(blocks: readonly BuilderBlock[], id: string): BuilderBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/** Shows a hidden block or hides a visible one. Visible blocks carry no flag. */
export function toggleBlockHidden(blocks: readonly BuilderBlock[], id: string): BuilderBlock[] {
  return blocks.map((b) => {
    if (b.id !== id) return b;
    if (b.hidden) {
      const { hidden: _hidden, ...visible } = b;
      return visible;
    }
    return { ...b, hidden: true };
  });
}

export function setBlockProp(
  blocks: readonly BuilderBlock[],
  id: string,
  key: string,
  value: unknown,
): BuilderBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, [key]: value } } : b));
}

export type BuilderListItem = Record<string, string>;

/**
 * Items of a list field as the editor shows them, whatever shape the stored
 * value has: an array of objects (canonical or aliased keys), an array of
 * strings (first item key), or a legacy multiline `a | b | c` string.
 */
export function readListItems(field: BuilderListFieldDef, raw: unknown): BuilderListItem[] {
  const keys = field.item.map((f) => f.key);
  const known = new Set([...keys, ...Object.values(field.aliases ?? {}).flat()]);
  const fromObject = (value: Record<string, unknown>): BuilderListItem => {
    // Keys the editor does not show (e.g. a generated `icon` or `stars`) are
    // kept as they are, so editing a text never drops them.
    const item: BuilderListItem = {};
    for (const [key, extra] of Object.entries(value)) {
      if (!known.has(key) && (typeof extra === 'string' || typeof extra === 'number')) {
        item[key] = String(extra);
      }
    }
    for (const key of keys) {
      const candidates = [key, ...(field.aliases?.[key] ?? [])];
      const found = candidates.map((k) => value[k]).find((v) => v !== undefined && v !== null && v !== '');
      item[key] = found === undefined ? '' : String(found);
    }
    return item;
  };
  const fromParts = (parts: string[]): BuilderListItem =>
    Object.fromEntries(keys.map((key, i) => [key, (parts[i] ?? '').trim()]));

  if (Array.isArray(raw)) {
    return raw
      .map((value) => {
        if (typeof value === 'string') return fromParts([value]);
        if (value && typeof value === 'object') return fromObject(value as Record<string, unknown>);
        return null;
      })
      .filter((item): item is BuilderListItem => item !== null);
  }
  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => fromParts(line.split('|')));
  }
  return [];
}

/** Trims the items and drops those whose editable fields are all empty. */
export function cleanListItems(field: BuilderListFieldDef, items: readonly BuilderListItem[]): BuilderListItem[] {
  return items
    .map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v.trim()])))
    .filter((item) => field.item.some((f) => (item[f.key] ?? '').length > 0));
}

/** A one-line summary of a block for the outline (its title, else its first text). */
export function blockSummary(block: BuilderBlock): string {
  const props = block.props ?? {};
  for (const key of ['title', 'badge', 'subtitle', 'description', 'body', 'address']) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * The blocks as they are saved: every list field the catalog declares, when
 * edited as items (an array), loses its blank items. Lists still in a legacy
 * shape (multiline text) are left untouched until the owner edits them.
 */
export function cleanBlockLists(catalog: BuilderCatalog, blocks: readonly BuilderBlock[]): BuilderBlock[] {
  return blocks.map((block) => {
    const lists = (blockDef(catalog, block.type)?.fields ?? []).filter(
      (f): f is BuilderListFieldDef => f.kind === 'list' && Array.isArray(block.props[f.key]),
    );
    if (lists.length === 0) return block;
    const props = { ...block.props };
    for (const field of lists) props[field.key] = cleanListItems(field, readListItems(field, props[field.key]));
    return { ...block, props };
  });
}
