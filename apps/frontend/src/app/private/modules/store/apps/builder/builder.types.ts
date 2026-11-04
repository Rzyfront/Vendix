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
  | { key: string; label: string; kind: 'url'; placeholder?: string; hint?: string };

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
