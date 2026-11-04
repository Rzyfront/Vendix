/**
 * Apps F2 — frontend mirror of the per-app page contract
 * (backend `domains/store/apps/shared/app-page.contract.ts`).
 *
 * The backend owns validation; this file only describes the document and the
 * editor widgets of each field. Each app declares its own blocks and its
 * preconfigured base in its own template file (`*.template.ts`), so a new
 * visual reference only replaces that file.
 */

export const APP_PAGE_SCHEMA_VERSION = 1 as const;

export type PageAppKind = 'product_page' | 'service_page' | 'booking' | 'store_home';

export const PAGE_APP_KINDS: readonly PageAppKind[] = [
  'product_page',
  'service_page',
  'booking',
  'store_home',
];

export function isPageAppKind(kind: string | null | undefined): kind is PageAppKind {
  return !!kind && (PAGE_APP_KINDS as readonly string[]).includes(kind);
}

/** What the page does: book, sell, both, or only inform. */
export type AppPageMode = 'booking' | 'sales' | 'both' | 'info';

export const APP_PAGE_MODE_OPTIONS: readonly { value: AppPageMode; label: string; hint: string }[] = [
  { value: 'sales', label: 'Solo compra', hint: 'Carrito y checkout de la tienda; sin agenda.' },
  { value: 'booking', label: 'Solo reserva', hint: 'Agenda o habitaciones; sin carrito ni checkout.' },
  { value: 'both', label: 'Reserva + compra', hint: 'Reserva y además vende productos.' },
  { value: 'info', label: 'Informativa', hint: 'Sin transacción: solo muestra la información.' },
];

/** Mode of each app before F2 (no saved page). Mirrors `DEFAULT_APP_MODE`. */
export const DEFAULT_APP_MODE: Record<PageAppKind, AppPageMode> = {
  product_page: 'sales',
  service_page: 'both',
  booking: 'both',
  store_home: 'info',
};

export function modeSells(mode: AppPageMode): boolean {
  return mode === 'sales' || mode === 'both';
}

export function modeBooks(mode: AppPageMode): boolean {
  return mode === 'booking' || mode === 'both';
}

export const APP_PAGE_FONTS: readonly { value: AppPageFont; label: string }[] = [
  { value: 'system', label: 'Del sistema' },
  { value: 'inter', label: 'Inter' },
  { value: 'poppins', label: 'Poppins' },
  { value: 'playfair', label: 'Playfair Display' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'lora', label: 'Lora' },
];

export type AppPageFont = 'system' | 'inter' | 'poppins' | 'playfair' | 'montserrat' | 'lora';

export interface AppPageBlock {
  id: string;
  type: string;
  /** `false` keeps the block and its texts without showing it. */
  enabled: boolean;
  props: Record<string, unknown>;
}

export interface AppPageSales {
  enabled?: boolean;
  /** `single`: sells one product (with its variants); `catalog`: several. */
  product_mode?: 'single' | 'catalog';
  show_cart?: boolean;
  checkout?: 'store';
}

export interface AppPageBooking {
  enabled?: boolean;
  source?: 'agenda' | 'rooms';
  require_account?: false;
}

export interface AppPageBrand {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  font_family?: AppPageFont;
  cover_url?: string;
}

export interface AppPageSeo {
  title?: string;
  description?: string;
  image_url?: string;
}

export interface AppPageHero {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  image_url?: string;
  button_label?: string;
}

/** `store_apps.config.page`. Every field but the version and blocks is optional. */
export interface AppPageDocument {
  schema_version: typeof APP_PAGE_SCHEMA_VERSION;
  mode?: AppPageMode;
  sales?: AppPageSales;
  booking?: AppPageBooking;
  brand?: AppPageBrand;
  seo?: AppPageSeo;
  hero?: AppPageHero;
  blocks: AppPageBlock[];
}

/** The effective mode of a page: the saved one or the app's pre-F2 mode. */
export function effectiveMode(kind: PageAppKind, page: AppPageDocument | null | undefined): AppPageMode {
  return page?.mode ?? DEFAULT_APP_MODE[kind];
}

// ---------------------------------------------------------------------------
// Editor field definitions (labels and widgets; limits mirror the backend)
// ---------------------------------------------------------------------------

export type ScalarFieldDef =
  | { key: string; label: string; kind: 'text'; max: number; multiline?: boolean; placeholder?: string }
  | { key: string; label: string; kind: 'url'; placeholder?: string }
  | { key: string; label: string; kind: 'bool' }
  | { key: string; label: string; kind: 'int'; min: number; max: number };

export type FieldDef =
  | ScalarFieldDef
  | { key: string; label: string; kind: 'list'; max: number; itemLabel: string; item: ScalarFieldDef[] }
  | { key: string; label: string; kind: 'text_list'; max: number; itemMax: number }
  | { key: string; label: string; kind: 'url_list'; max: number };

export interface BlockDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  /**
   * The block stands for a section the public page already renders (product
   * detail, service list, room search, products, apps): its fields only
   * retitle it and turning it off hides it.
   */
  existing?: boolean;
  fields: FieldDef[];
}

/** One app's template: its own blocks and its preconfigured base page. */
export interface AppPageTemplate {
  kind: PageAppKind;
  /** Short description of what the base page looks like (shown in the editor). */
  summary: string;
  /** Reference the base follows (REFERENCIAS.md), for the owner. */
  reference: string;
  blocks: BlockDef[];
  /** The page a new app starts from (never saved until the owner saves it). */
  page: AppPageDocument;
}

// Shared field builders --------------------------------------------------------

export const titleField = (label = 'Título'): ScalarFieldDef => ({ key: 'title', label, kind: 'text', max: 80 });
export const subtitleField = (): ScalarFieldDef => ({ key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 });

export const cardsFields = (itemLabel: string): FieldDef[] => [
  titleField(),
  {
    key: 'items',
    label: 'Tarjetas',
    kind: 'list',
    max: 6,
    itemLabel,
    item: [
      { key: 'title', label: 'Título', kind: 'text', max: 60 },
      { key: 'text', label: 'Texto', kind: 'text', max: 240, multiline: true },
    ],
  },
];

export const stepsFields = (): FieldDef[] => [
  titleField(),
  {
    key: 'items',
    label: 'Pasos',
    kind: 'list',
    max: 6,
    itemLabel: 'Paso',
    item: [
      { key: 'title', label: 'Título', kind: 'text', max: 60 },
      { key: 'text', label: 'Texto', kind: 'text', max: 240, multiline: true },
    ],
  },
];

export const testimonialsFields = (): FieldDef[] => [
  titleField(),
  { key: 'rating_summary', label: 'Calificación promedio (ej. 4.9/5)', kind: 'text', max: 20 },
  {
    key: 'items',
    label: 'Testimonios',
    kind: 'list',
    max: 9,
    itemLabel: 'Testimonio',
    item: [
      { key: 'name', label: 'Nombre', kind: 'text', max: 60 },
      { key: 'city', label: 'Ciudad', kind: 'text', max: 60 },
      { key: 'quote', label: 'Testimonio', kind: 'text', max: 400, multiline: true },
      { key: 'rating', label: 'Estrellas (1-5)', kind: 'int', min: 1, max: 5 },
    ],
  },
];

export const faqFields = (): FieldDef[] => [
  titleField(),
  {
    key: 'items',
    label: 'Preguntas',
    kind: 'list',
    max: 12,
    itemLabel: 'Pregunta',
    item: [
      { key: 'question', label: 'Pregunta', kind: 'text', max: 160 },
      { key: 'answer', label: 'Respuesta', kind: 'text', max: 800, multiline: true },
    ],
  },
];

export const galleryFields = (): FieldDef[] => [
  titleField(),
  { key: 'image_urls', label: 'Imágenes (URL https)', kind: 'url_list', max: 12 },
];

export const ctaFields = (): FieldDef[] => [
  titleField(),
  { key: 'text', label: 'Texto', kind: 'text', max: 300, multiline: true },
  { key: 'button_label', label: 'Texto del botón', kind: 'text', max: 40 },
];

/** Hero fields, common to every app page. */
export const HERO_FIELDS: ScalarFieldDef[] = [
  { key: 'eyebrow', label: 'Antetítulo', kind: 'text', max: 60 },
  { key: 'title', label: 'Título', kind: 'text', max: 120 },
  { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 300, multiline: true },
  { key: 'image_url', label: 'Imagen (URL https)', kind: 'url' },
  { key: 'button_label', label: 'Texto del botón', kind: 'text', max: 40 },
];

export const SEO_FIELDS: ScalarFieldDef[] = [
  { key: 'title', label: 'Título SEO', kind: 'text', max: 70 },
  { key: 'description', label: 'Descripción SEO', kind: 'text', max: 170, multiline: true },
  { key: 'image_url', label: 'Imagen para compartir (URL https)', kind: 'url' },
];

/** Deep copy of a template page, so editing never mutates the template. */
export function clonePage(page: AppPageDocument): AppPageDocument {
  return JSON.parse(JSON.stringify(page)) as AppPageDocument;
}
