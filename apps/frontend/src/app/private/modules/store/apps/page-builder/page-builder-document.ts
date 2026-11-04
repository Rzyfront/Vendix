import type { BuilderBlock, BuilderBlockDef, BuilderCatalog, BuilderCategory, BuilderFieldDef, BuilderListFieldDef, BuilderOperationMode, BuilderScalarFieldDef } from '../builder/builder.types';
import { blockDef, cleanListItems, readListItems } from '../builder/builder-blocks';
import {
  APP_PAGE_SCHEMA_VERSION,
  APP_PAGE_TEMPLATES,
  AppPageBlock,
  AppPageDocument,
  AppPageHero,
  FieldDef,
  HERO_FIELDS,
  PageAppKind,
  ScalarFieldDef,
} from '../templates';

/**
 * F6-B — bridge between an app's page document (`store_apps.config.page`,
 * `AppPageDocument`) and the page builder engine (`builder/`), shared by the
 * store home, product page, service page and booking.
 *
 * - The cover (`page.hero`) is edited as a virtual block `hero`: always first,
 *   never moved, hidden or removed (`BuilderBlockDef.virtual`).
 * - A hidden builder block is a block with `enabled: false`, as the public
 *   page already reads it.
 * - Each app's catalog comes from its template (`templates/*.template.ts`),
 *   so the builder offers exactly the blocks and fields the backend contract
 *   accepts. Sections the public layout draws itself (`existing`) are pinned
 *   to the place the layout gives them.
 */

/** Id of the virtual cover block inside the builder (never saved as a block). */
export const HERO_BLOCK_ID = 'hero';
export const HERO_BLOCK_TYPE = 'hero';

/** Same limit as the backend (`MAX_APP_PAGE_BLOCKS`). */
export const MAX_PAGE_BLOCKS = 12;

/** Where and in which modes one block of an app goes in its builder catalog. */
export interface PageBlockMeta {
  category: string;
  pinned?: 'start' | 'end';
  /** `false` for sections the public page shows when the block is absent (only hiding takes them off). */
  removable?: boolean;
  modes?: readonly BuilderOperationMode[];
  liveData?: string;
}

/** Item key of the lists of plain texts or links (`text_list`, `url_list`). */
const SCALAR_ITEM_KEY = 'value';

function scalarField(def: ScalarFieldDef): BuilderScalarFieldDef {
  switch (def.kind) {
    case 'text':
      return { key: def.key, label: def.label, kind: def.multiline ? 'textarea' : 'text', max: def.max, placeholder: def.placeholder };
    case 'url':
      return { key: def.key, label: def.label, kind: 'url', placeholder: def.placeholder ?? 'https://…' };
    case 'bool':
      return { key: def.key, label: def.label, kind: 'toggle' };
    case 'int':
      return { key: def.key, label: def.label, kind: 'number', min: def.min, max: def.max };
  }
}

/** The builder field of a template field. */
export function builderField(def: FieldDef): BuilderFieldDef {
  switch (def.kind) {
    case 'list':
      return { key: def.key, label: def.label, kind: 'list', itemLabel: def.itemLabel, max: def.max, item: def.item.map(scalarField) };
    case 'text_list':
      return {
        key: def.key,
        label: def.label,
        kind: 'list',
        itemLabel: 'Elemento',
        max: def.max,
        item: [{ key: SCALAR_ITEM_KEY, label: 'Texto', kind: 'text', max: def.itemMax }],
      };
    case 'url_list':
      return {
        key: def.key,
        label: def.label,
        kind: 'list',
        itemLabel: 'Imagen',
        max: def.max,
        item: [{ key: SCALAR_ITEM_KEY, label: 'Enlace https', kind: 'url', placeholder: 'https://…/foto.jpg' }],
      };
    default:
      return scalarField(def);
  }
}

/**
 * The builder catalog of an app: its cover plus the template blocks, each
 * with the category, pinning and modes `meta` gives it. A template block
 * without meta is left out (the app chose not to offer it).
 */
export function pageBuilderCatalog(
  kind: PageAppKind,
  categories: readonly BuilderCategory[],
  meta: Readonly<Record<string, PageBlockMeta>>,
  heroCategory = categories[0]?.id ?? 'essentials',
): BuilderCatalog {
  const template = APP_PAGE_TEMPLATES[kind];
  const hero: BuilderBlockDef = {
    type: HERO_BLOCK_TYPE,
    label: 'Portada',
    description: 'Lo primero que se ve: título, subtítulo, imagen y botón. Vacía, la página usa su portada de siempre.',
    icon: 'panel-top',
    category: heroCategory,
    fields: HERO_FIELDS.map(scalarField),
    single: true,
    virtual: true,
  };
  const blocks: BuilderBlockDef[] = [hero];
  for (const def of template.blocks) {
    const m = meta[def.type];
    if (!m) continue;
    blocks.push({
      type: def.type,
      label: def.label,
      description: def.description,
      icon: def.icon,
      category: m.category,
      fields: def.fields.map(builderField),
      // The sections the layout draws are read with `blocks.find(type)`: one per page.
      single: !!def.existing,
      pinned: m.pinned,
      removable: m.removable,
      modes: m.modes,
      liveData: m.liveData,
    });
  }
  return { appKind: kind, maxBlocks: MAX_PAGE_BLOCKS, categories, blocks };
}

/** The builder blocks of a page: its cover first, then its blocks (`enabled: false` = hidden). */
export function pageToBlocks(page: AppPageDocument): BuilderBlock[] {
  const hero: BuilderBlock = { id: HERO_BLOCK_ID, type: HERO_BLOCK_TYPE, props: { ...(page.hero ?? {}) } };
  return [
    hero,
    ...page.blocks.map((b) => {
      const block: BuilderBlock = { id: b.id, type: b.type, props: { ...b.props } };
      if (!b.enabled) block.hidden = true;
      return block;
    }),
  ];
}

function cleanScalarItems(field: BuilderListFieldDef, raw: unknown): string[] {
  return cleanListItems(field, readListItems(field, raw)).map((item) => item[SCALAR_ITEM_KEY]);
}

/** List items as stored: blank ones dropped and number fields as numbers (empty or out of range dropped). */
function cleanTypedItems(field: BuilderListFieldDef, raw: unknown): Record<string, string | number>[] {
  return cleanListItems(field, readListItems(field, raw)).map((item) => {
    const out: Record<string, string | number> = { ...item };
    for (const sub of field.item) {
      if (sub.kind !== 'number') continue;
      const n = Number(out[sub.key]);
      if (out[sub.key] === '' || !Number.isInteger(n) || n < sub.min || n > sub.max) delete out[sub.key];
      else out[sub.key] = n;
    }
    return out;
  });
}

/** The props of a block as the contract stores them, following its template fields. */
export function cleanBlockProps(fields: readonly FieldDef[], props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const def of fields) {
    const value = out[def.key];
    if (value === undefined || value === null) continue;
    if (def.kind === 'list') {
      out[def.key] = cleanTypedItems(builderField(def) as BuilderListFieldDef, value);
    } else if (def.kind === 'text_list' || def.kind === 'url_list') {
      out[def.key] = cleanScalarItems(builderField(def) as BuilderListFieldDef, value);
    }
  }
  return out;
}

/**
 * The page document of the builder state: `base` keeps mode, sales, booking,
 * brand, theme and SEO; the cover and the blocks come from `blocks`.
 */
export function blocksToPage(
  kind: PageAppKind,
  catalog: BuilderCatalog,
  base: AppPageDocument,
  blocks: readonly BuilderBlock[],
): AppPageDocument {
  const fieldsOf = new Map(APP_PAGE_TEMPLATES[kind].blocks.map((b) => [b.type, b.fields]));
  const heroBlock = blocks.find((b) => blockDef(catalog, b.type)?.virtual);
  const hero = cleanHero(heroBlock?.props ?? {});
  const page: AppPageDocument = {
    ...base,
    schema_version: APP_PAGE_SCHEMA_VERSION,
    blocks: blocks
      .filter((b) => !blockDef(catalog, b.type)?.virtual)
      .map(
        (b): AppPageBlock => ({
          id: b.id,
          type: b.type,
          enabled: !b.hidden,
          props: cleanBlockProps(fieldsOf.get(b.type) ?? [], b.props),
        }),
      ),
  };
  delete page.hero;
  if (hero) page.hero = hero;
  return page;
}

/** Only the hero texts that have content; `null` when none (the page keeps its usual cover). */
function cleanHero(props: Record<string, unknown>): AppPageHero | null {
  const hero: Record<string, string> = {};
  for (const def of HERO_FIELDS) {
    const value = props[def.key];
    if (typeof value === 'string' && value.trim()) hero[def.key] = value.trim();
  }
  return Object.keys(hero).length ? (hero as AppPageHero) : null;
}

/** A page with nothing of its own: the public page renders as it did before F2. */
export function emptyPage(): AppPageDocument {
  return { schema_version: APP_PAGE_SCHEMA_VERSION, blocks: [] };
}

/** The page the app saved (`config.page`), or `null` when it never saved one. */
export function storedPage(config: unknown): AppPageDocument | null {
  const page = (config as { page?: unknown } | null)?.page as Partial<AppPageDocument> | null | undefined;
  if (!page || typeof page !== 'object' || !Array.isArray(page.blocks)) return null;
  return { ...page, schema_version: APP_PAGE_SCHEMA_VERSION, blocks: page.blocks } as AppPageDocument;
}
