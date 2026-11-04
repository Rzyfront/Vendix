/**
 * Apps F2 — contract of an app's own page (`store_apps.config.page`).
 *
 * Same editing pattern as the CRM landing (`crm-blocks.contract.ts`: an
 * ordered `blocks[{ id, type, props }]` document), but every app has its OWN
 * block catalog: a product page is built from product blocks, a service page
 * from service blocks, a booking page from lodging blocks and the store home
 * from entry blocks. No landing block is allowed outside the landing, which
 * keeps its own contract unchanged.
 *
 * On top of the content, every app carries the same cross-cutting settings
 * (Rafael, 2026-11-03, REFERENCIAS.md "Regla transversal"):
 * - `mode`: `booking` | `sales` | `both` | `info` — whether the page books,
 *   sells, does both or only informs. The cart and checkout are the online
 *   store's ones and only turn on when the mode sells.
 * - `sales`: `{ enabled, product_mode: 'single' | 'catalog', show_cart, checkout: 'store' }`.
 * - `booking`: `{ enabled, source: 'agenda' | 'rooms', require_account: false }`.
 *   `sales.enabled` / `booking.enabled` are derived from `mode` on save, so
 *   they can never contradict it.
 * - `brand`: logo, colors, font, cover. `seo`: title, description, image.
 *   The hostname is the app's domain (settings panel), not part of the page.
 *
 * Everything is optional: a store without `config.page` renders its public
 * page exactly as before F2. A stored page that no longer validates (e.g. a
 * block type removed later) is read as `null`, i.e. the page falls back to
 * its pre-F2 rendering instead of breaking.
 *
 * The frontend mirrors this catalog in `private/modules/store/apps/templates/`
 * (labels, field widgets and the preconfigured base of each app). Changing a
 * block or a field here is a contract change: update both sides and bump
 * `APP_PAGE_SCHEMA_VERSION` if old documents stop validating.
 */

export const APP_PAGE_SCHEMA_VERSION = 1;

/** Apps with an own page editor. The landing keeps the CRM editor. */
export const PAGE_APP_KINDS = [
  'product_page',
  'service_page',
  'booking',
  'store_home',
] as const;

export type PageAppKind = (typeof PAGE_APP_KINDS)[number];

export const APP_PAGE_MODES = ['booking', 'sales', 'both', 'info'] as const;
export type AppPageMode = (typeof APP_PAGE_MODES)[number];

export const APP_PAGE_FONTS = [
  'system',
  'inter',
  'poppins',
  'playfair',
  'montserrat',
  'lora',
] as const;

/**
 * Mode each app has today, before F2, when it has no saved page: the product
 * page sells, the service page and the booking page book and also sell their
 * secondary products, the store home only informs.
 */
export const DEFAULT_APP_MODE: Record<PageAppKind, AppPageMode> = {
  product_page: 'sales',
  service_page: 'both',
  booking: 'both',
  store_home: 'info',
};

// ---------------------------------------------------------------------------
// Field specs
// ---------------------------------------------------------------------------

type ScalarField =
  | { kind: 'text'; max: number }
  | { kind: 'url' }
  | { kind: 'bool' }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'enum'; values: readonly string[] };

type FieldSpec =
  | ScalarField
  | { kind: 'list'; max: number; item: Record<string, ScalarField> }
  | { kind: 'text_list'; max: number; itemMax: number }
  | { kind: 'url_list'; max: number };

type FieldsSpec = Record<string, FieldSpec>;

const text = (max: number): ScalarField => ({ kind: 'text', max });
const url: ScalarField = { kind: 'url' };
const bool: ScalarField = { kind: 'bool' };
const int = (min: number, max: number): ScalarField => ({ kind: 'int', min, max });
const oneOf = (values: readonly string[]): ScalarField => ({ kind: 'enum', values });

const TITLE = text(80);
const SUBTITLE = text(200);

const FAQ: FieldsSpec = {
  title: TITLE,
  items: {
    kind: 'list',
    max: 12,
    item: { question: text(160), answer: text(800) },
  },
};

const GALLERY: FieldsSpec = {
  title: TITLE,
  image_urls: { kind: 'url_list', max: 12 },
};

/** Title + text cards (benefits, highlights). */
const CARDS: FieldsSpec = {
  title: TITLE,
  items: {
    kind: 'list',
    max: 6,
    item: { title: text(60), text: text(240) },
  },
};

/** "Cómo funciona" in numbered steps. */
const STEPS: FieldsSpec = {
  title: TITLE,
  items: {
    kind: 'list',
    max: 6,
    item: { title: text(60), text: text(240) },
  },
};

/** Testimonials with name, city, result and a 1-5 rating. */
const TESTIMONIALS: FieldsSpec = {
  title: TITLE,
  /** Average shown next to the title, e.g. "4.9/5". */
  rating_summary: text(20),
  items: {
    kind: 'list',
    max: 9,
    item: {
      name: text(60),
      city: text(60),
      quote: text(400),
      rating: int(1, 5),
    },
  },
};

const CTA: FieldsSpec = {
  title: TITLE,
  text: text(300),
  button_label: text(40),
};

/**
 * Block catalog of each app: block type → its props. One block per type per
 * page; the order of `blocks[]` is the order of the page. Blocks marked
 * "existing" stand for a section the public page already renders (their
 * props only retitle it and `enabled: false` hides it).
 */
export const APP_PAGE_BLOCKS: Record<PageAppKind, Record<string, FieldsSpec>> =
  {
    product_page: {
      /** "Por qué elegirlo": short benefit cards under the product. */
      benefits: CARDS,
      how_it_works: STEPS,
      specifications: {
        title: TITLE,
        items: {
          kind: 'list',
          max: 24,
          item: { label: text(60), value: text(200) },
        },
      },
      gallery: GALLERY,
      testimonials: TESTIMONIALS,
      /** Existing: "Complementa tu compra". */
      complements: { title: TITLE },
      shipping_warranty: {
        title: TITLE,
        shipping: text(500),
        warranty: text(500),
        returns: text(500),
      },
      faq: FAQ,
      cta: CTA,
    },
    service_page: {
      /** Existing: the service list (cards with duration and price). */
      services: {
        title: TITLE,
        subtitle: SUBTITLE,
        show_duration: bool,
        show_price: bool,
      },
      how_it_works: STEPS,
      team: {
        title: TITLE,
        items: {
          kind: 'list',
          max: 12,
          item: {
            name: text(80),
            role: text(80),
            bio: text(400),
            photo_url: url,
          },
        },
      },
      policies: {
        title: TITLE,
        deposit: text(500),
        cancellation: text(800),
        reminders: text(500),
      },
      gallery: GALLERY,
      testimonials: TESTIMONIALS,
      faq: FAQ,
      /** Existing: the secondary "también puedes comprar" products. */
      products: { title: TITLE },
      cta: CTA,
    },
    booking: {
      /** Existing: the PMS search (dates, guests) and the room types with rate. */
      search: { title: TITLE, subtitle: SUBTITLE },
      amenities: {
        title: TITLE,
        items: { kind: 'text_list', max: 24, itemMax: 60 },
      },
      policies: {
        title: TITLE,
        check_in: text(40),
        check_out: text(40),
        cancellation: text(800),
        house_rules: text(800),
      },
      gallery: GALLERY,
      testimonials: TESTIMONIALS,
      location: {
        title: TITLE,
        address: text(200),
        text: text(500),
        map_url: url,
      },
      faq: FAQ,
      /** Existing: the online check-in note. */
      checkin_info: { text: text(300) },
      /** Existing: the "para tu estadía" products. */
      products: { title: TITLE },
    },
    store_home: {
      /** Cards to the store's published apps (automatic). */
      apps: { title: TITLE, subtitle: SUBTITLE },
      highlights: CARDS,
      contact: {
        title: TITLE,
        phone: text(40),
        email: text(120),
        address: text(200),
        hours: text(300),
      },
    },
  };

const HERO: FieldsSpec = {
  eyebrow: text(60),
  title: text(120),
  subtitle: text(300),
  image_url: url,
  button_label: text(40),
};

const BRAND: FieldsSpec = {
  logo_url: url,
  primary_color: text(7),
  secondary_color: text(7),
  font_family: oneOf(APP_PAGE_FONTS),
  cover_url: url,
};

const SEO: FieldsSpec = {
  title: text(70),
  description: text(170),
  image_url: url,
};

const SALES: FieldsSpec = {
  enabled: bool,
  product_mode: oneOf(['single', 'catalog']),
  show_cart: bool,
  checkout: oneOf(['store']),
};

const BOOKING: FieldsSpec = {
  enabled: bool,
  source: oneOf(['agenda', 'rooms']),
  require_account: bool,
};

export const MAX_APP_PAGE_BLOCKS = 12;
const BLOCK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_URL = 1000;

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export interface AppPageBlock {
  id: string;
  type: string;
  /** `false` keeps the block (and its texts) without showing it. */
  enabled: boolean;
  props: Record<string, unknown>;
}

export interface AppPageSales {
  enabled?: boolean;
  product_mode?: 'single' | 'catalog';
  show_cart?: boolean;
  checkout?: 'store';
}

export interface AppPageBooking {
  enabled?: boolean;
  source?: 'agenda' | 'rooms';
  require_account?: false;
}

export interface AppPageDocument {
  schema_version: typeof APP_PAGE_SCHEMA_VERSION;
  mode?: AppPageMode;
  sales?: AppPageSales;
  booking?: AppPageBooking;
  brand?: {
    logo_url?: string;
    primary_color?: string;
    secondary_color?: string;
    font_family?: (typeof APP_PAGE_FONTS)[number];
    cover_url?: string;
  };
  seo?: { title?: string; description?: string; image_url?: string };
  hero?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    image_url?: string;
    button_label?: string;
  };
  blocks: AppPageBlock[];
}

export interface AppPageValidationResult {
  valid: boolean;
  errors: string[];
  /** Trimmed copy with empty strings and empty optional groups removed. */
  value: AppPageDocument | null;
}

export function isPageAppKind(kind: string): kind is PageAppKind {
  return (PAGE_APP_KINDS as readonly string[]).includes(kind);
}

/** Whether a mode sells (cart and checkout on). */
export function modeSells(mode: AppPageMode): boolean {
  return mode === 'sales' || mode === 'both';
}

/** Whether a mode books (agenda or rooms on). */
export function modeBooks(mode: AppPageMode): boolean {
  return mode === 'booking' || mode === 'both';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  if (value.length > MAX_URL || !value.startsWith('https://')) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks one scalar value. Returns the cleaned value, `undefined` for an
 * empty one (dropped), or pushes an error.
 */
function cleanScalar(
  spec: ScalarField,
  value: unknown,
  path: string,
  errors: string[],
): unknown {
  if (value === null || value === undefined) return undefined;
  if (spec.kind === 'bool') {
    if (typeof value !== 'boolean') {
      errors.push(`${path} debe ser verdadero o falso.`);
    }
    return value;
  }
  if (spec.kind === 'int') {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < spec.min ||
      value > spec.max
    ) {
      errors.push(`${path} debe ser un entero entre ${spec.min} y ${spec.max}.`);
      return undefined;
    }
    return value;
  }
  if (typeof value !== 'string') {
    errors.push(`${path} debe ser texto.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (spec.kind === 'enum') {
    if (!spec.values.includes(trimmed)) {
      errors.push(`${path} debe ser uno de: ${spec.values.join(', ')}.`);
    }
    return trimmed;
  }
  if (spec.kind === 'url') {
    if (!isHttpsUrl(trimmed)) errors.push(`${path} debe ser una URL https.`);
    return trimmed;
  }
  if (trimmed.length > spec.max) {
    errors.push(`${path} supera ${spec.max} caracteres.`);
  }
  return trimmed;
}

function cleanFields(
  spec: FieldsSpec,
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    errors.push(`${path} debe ser un objeto.`);
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!(key in spec)) errors.push(`${path}.${key} no es un campo permitido.`);
  }
  for (const [key, field] of Object.entries(spec)) {
    const fieldPath = `${path}.${key}`;
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (field.kind === 'list') {
      if (!Array.isArray(raw)) {
        errors.push(`${fieldPath} debe ser una lista.`);
        continue;
      }
      if (raw.length > field.max) {
        errors.push(`${fieldPath} admite máximo ${field.max} elementos.`);
      }
      const items = raw
        .map((item, i) =>
          cleanFields(field.item, item, `${fieldPath}[${i}]`, errors),
        )
        .filter((item) => Object.keys(item).length > 0);
      if (items.length) out[key] = items;
    } else if (field.kind === 'text_list' || field.kind === 'url_list') {
      if (!Array.isArray(raw)) {
        errors.push(`${fieldPath} debe ser una lista.`);
        continue;
      }
      if (raw.length > field.max) {
        errors.push(`${fieldPath} admite máximo ${field.max} elementos.`);
      }
      const scalar: ScalarField =
        field.kind === 'url_list' ? url : text(field.itemMax);
      const items = raw
        .map((item, i) =>
          cleanScalar(scalar, item, `${fieldPath}[${i}]`, errors),
        )
        .filter((item) => item !== undefined);
      if (items.length) out[key] = items;
    } else {
      const cleaned = cleanScalar(field, raw, fieldPath, errors);
      if (cleaned !== undefined) out[key] = cleaned;
    }
  }
  return out;
}

function checkColor(
  group: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): void {
  const value = group[key];
  if (typeof value === 'string' && !HEX_COLOR_RE.test(value)) {
    errors.push(`${path}.${key} debe ser un color #RRGGBB.`);
  }
}

/**
 * Validates and cleans a page document for `kind`. Never throws: returns the
 * accumulated errors so the admin DTO can report every wrong field.
 */
export function validateAppPage(
  kind: PageAppKind,
  value: unknown,
): AppPageValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return {
      valid: false,
      errors: ['La página debe ser un objeto.'],
      value: null,
    };
  }
  const allowedRoot = [
    'schema_version',
    'mode',
    'sales',
    'booking',
    'brand',
    'seo',
    'hero',
    'blocks',
  ];
  for (const key of Object.keys(value)) {
    if (!allowedRoot.includes(key)) {
      errors.push(`${key} no es un campo permitido.`);
    }
  }
  if (value['schema_version'] !== APP_PAGE_SCHEMA_VERSION) {
    errors.push(`schema_version debe ser ${APP_PAGE_SCHEMA_VERSION}.`);
  }

  const mode = cleanScalar(oneOf(APP_PAGE_MODES), value['mode'], 'mode', errors) as
    | AppPageMode
    | undefined;
  const sales = cleanFields(SALES, value['sales'], 'sales', errors);
  const booking = cleanFields(BOOKING, value['booking'], 'booking', errors);
  if (booking['require_account'] === true) {
    errors.push('booking.require_account: la reserva no exige cuenta.');
  }
  const brand = cleanFields(BRAND, value['brand'], 'brand', errors);
  checkColor(brand, 'primary_color', 'brand', errors);
  checkColor(brand, 'secondary_color', 'brand', errors);
  const seo = cleanFields(SEO, value['seo'], 'seo', errors);
  const hero = cleanFields(HERO, value['hero'], 'hero', errors);

  const catalog = APP_PAGE_BLOCKS[kind];
  const blocks: AppPageBlock[] = [];
  if (!Array.isArray(value['blocks'])) {
    errors.push('blocks debe ser una lista.');
  } else {
    if (value['blocks'].length > MAX_APP_PAGE_BLOCKS) {
      errors.push(`blocks admite máximo ${MAX_APP_PAGE_BLOCKS} secciones.`);
    }
    const ids = new Set<string>();
    const types = new Set<string>();
    value['blocks'].forEach((block, index) => {
      const path = `blocks[${index}]`;
      if (!isPlainObject(block)) {
        errors.push(`${path} debe ser un objeto.`);
        return;
      }
      for (const key of Object.keys(block)) {
        if (!['id', 'type', 'enabled', 'props'].includes(key)) {
          errors.push(`${path}.${key} no es un campo permitido.`);
        }
      }
      const id = block['id'];
      const type = block['type'];
      if (typeof id !== 'string' || !BLOCK_ID_RE.test(id)) {
        errors.push(`${path}.id no es válido.`);
      } else if (ids.has(id)) {
        errors.push(`${path}.id está repetido.`);
      } else {
        ids.add(id);
      }
      if (typeof type !== 'string' || !(type in catalog)) {
        errors.push(
          `${path}.type "${String(type)}" no es una sección de esta app.`,
        );
        return;
      }
      if (types.has(type)) {
        errors.push(`${path}.type "${type}" está repetido.`);
      }
      types.add(type);
      if (block['enabled'] !== undefined && typeof block['enabled'] !== 'boolean') {
        errors.push(`${path}.enabled debe ser verdadero o falso.`);
      }
      blocks.push({
        id: String(id),
        type,
        enabled: block['enabled'] !== false,
        props: cleanFields(catalog[type], block['props'], `${path}.props`, errors),
      });
    });
  }

  if (errors.length) return { valid: false, errors, value: null };

  const doc: AppPageDocument = {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    blocks,
  };
  if (mode) {
    doc.mode = mode;
    // `enabled` always follows the mode, so the flags never contradict it.
    sales['enabled'] = modeSells(mode);
    booking['enabled'] = modeBooks(mode);
  }
  if (Object.keys(sales).length) doc.sales = sales as AppPageSales;
  if (Object.keys(booking).length) doc.booking = booking as AppPageBooking;
  if (Object.keys(brand).length) doc.brand = brand as AppPageDocument['brand'];
  if (Object.keys(seo).length) doc.seo = seo as AppPageDocument['seo'];
  if (Object.keys(hero).length) doc.hero = hero as AppPageDocument['hero'];
  return { valid: true, errors: [], value: doc };
}

/**
 * Reads `config.page` for the public readers: the cleaned document, or
 * `null` when there is none or it no longer validates (the page then renders
 * as it did before F2).
 */
export function readAppPage(
  kind: PageAppKind,
  config: unknown,
): AppPageDocument | null {
  if (
    !isPlainObject(config) ||
    config['page'] === undefined ||
    config['page'] === null
  ) {
    return null;
  }
  const result = validateAppPage(kind, config['page']);
  return result.valid ? result.value : null;
}

/** The effective mode of a page: the saved one or the app's pre-F2 mode. */
export function effectiveMode(
  kind: PageAppKind,
  page: AppPageDocument | null,
): AppPageMode {
  return page?.mode ?? DEFAULT_APP_MODE[kind];
}

/**
 * Keeps `config.page` across the writes of the app's own settings (product,
 * services, domain), whose parsers only know their own keys.
 */
export function carryPage(raw: unknown): { page?: unknown } {
  return isPlainObject(raw) && isPlainObject(raw['page'])
    ? { page: raw['page'] }
    : {};
}
