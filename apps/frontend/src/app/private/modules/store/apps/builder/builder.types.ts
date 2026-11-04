/**
 * F6-A — page builder engine (motor de bloques).
 *
 * Generic, app-agnostic description of a block-based page: what blocks an app
 * offers (its catalog), how each block is edited (its fields) and in which
 * operation modes it makes sense. The landing is the first adapter
 * (`landing/landing-builder.catalog.ts`); the service page, product page,
 * booking page and store home plug in their own catalog the same way, without
 * touching the engine.
 */

/** What a page does. Same values as the app pages (`AppPageMode`). */
export type BuilderOperationMode = 'booking' | 'sales' | 'both' | 'info';

export const BUILDER_OPERATION_MODES: readonly BuilderOperationMode[] = ['booking', 'sales', 'both', 'info'];

/** A block inside a page document. `hidden` keeps it in the draft but off the page. */
export interface BuilderBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  hidden?: boolean;
}

export type BuilderScalarFieldDef =
  | {
      key: string;
      label: string;
      kind: 'text' | 'textarea';
      max: number;
      placeholder?: string;
      hint?: string;
    }
  | { key: string; label: string; kind: 'url'; placeholder?: string; hint?: string }
  /** F6-B: a whole number within `min`..`max` (e.g. a 1-5 rating). Stored as a number. */
  | { key: string; label: string; kind: 'number'; min: number; max: number; hint?: string }
  /** F6-B: a yes/no switch (e.g. show the price). Stored as a boolean; block fields only, not list items. */
  | { key: string; label: string; kind: 'toggle'; hint?: string };

/**
 * A repeatable list of items (benefits, testimonials, questions, photos).
 * `aliases` maps each item key to other keys older documents (or the AI
 * generator) used for the same value, so editing reads them; writes always
 * use the canonical keys. A legacy multiline string `a | b | c` is read with
 * the item keys in order.
 */
export interface BuilderListFieldDef {
  key: string;
  label: string;
  kind: 'list';
  itemLabel: string;
  max: number;
  item: BuilderScalarFieldDef[];
  aliases?: Record<string, readonly string[]>;
  /** Shown while the list is empty (e.g. the page shows sample items). */
  emptyHint?: string;
}

export type BuilderFieldDef = BuilderScalarFieldDef | BuilderListFieldDef;

export interface BuilderCategory {
  id: string;
  label: string;
}

export interface BuilderBlockDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  fields: BuilderFieldDef[];
  /** Modes where the block applies; absent = every mode. */
  modes?: readonly BuilderOperationMode[];
  /** At most one per page (e.g. the cover, the contact form). */
  single?: boolean;
  /**
   * The block's content comes from the store (e.g. real products); its
   * fields only retitle it. Shown to the owner so an empty-looking block
   * does not read as broken.
   */
  liveData?: string;
  /**
   * F6-B: the block is not part of the page's block list but edited like one
   * (e.g. the cover of the app pages, `page.hero`). It sits first, cannot be
   * moved, hidden, duplicated or removed, and does not count toward
   * `maxBlocks`.
   */
  virtual?: boolean;
  /**
   * F6-B: the public page draws this section at a fixed place (before or
   * after the free sections), whatever its position in the list. It cannot be
   * moved and free sections cannot pass it, so the outline never promises an
   * order the page does not have.
   */
  pinned?: 'start' | 'end';
  /** F6-B: `false` when removing the block would not take it off the page (only hiding does). */
  removable?: boolean;
}

/** The blocks one app type offers. */
export interface BuilderCatalog {
  /** App kind the catalog belongs to (`landing`, `service_page`…). */
  appKind: string;
  maxBlocks: number;
  categories: readonly BuilderCategory[];
  blocks: readonly BuilderBlockDef[];
}

export type BuilderDevice = 'mobile' | 'desktop';
