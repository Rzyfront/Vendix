/**
 * Apps — catálogo fijo de aplicaciones web por tienda
 * (odd/tasks/apps-module.md, D6/S3).
 *
 * Mirrors `app_kind_enum` / `app_status_enum` in schema.prisma. Declared as
 * literals here (not imported from `@prisma/client`) so the catalog is the
 * single ordered source the API answers with.
 */
export const APP_KINDS = [
  'ecommerce',
  'store_home',
  'landing',
  'product_page',
  'service_page',
  'booking',
] as const;

export type AppKind = (typeof APP_KINDS)[number];

export const APP_STATUSES = [
  'not_installed',
  'draft',
  'published',
  'disabled',
] as const;

export type AppStatus = (typeof APP_STATUSES)[number];

export interface AppCatalogEntry {
  key: AppKind;
  name: string;
  description: string;
  /**
   * Industries the app applies to. `null` = every industry. OR semantics
   * like `industry-capabilities.helper.ts`: a multi-industry store qualifies
   * when ANY of its industries is listed.
   */
  industries: readonly string[] | null;
}

export const APP_CATALOG: readonly AppCatalogEntry[] = [
  {
    key: 'ecommerce',
    name: 'Tienda en línea',
    description: 'Venta completa: catálogo, carrito, checkout y carta digital.',
    industries: null,
  },
  {
    key: 'store_home',
    name: 'Inicio de tienda',
    description:
      'Portada de entrada con la marca de la tienda y el botón de ingreso.',
    industries: null,
  },
  {
    key: 'landing',
    name: 'Landing page',
    description:
      'Captación de leads y una oferta concreta; los contactos llegan al CRM.',
    industries: null,
  },
  {
    key: 'product_page',
    name: 'Product page',
    description:
      'Un producto principal con sus complementos y su propio dominio.',
    industries: null,
  },
  {
    key: 'service_page',
    name: 'Service page',
    description: 'Servicios y agendamiento primero; también vende productos.',
    industries: null,
  },
  {
    key: 'booking',
    name: 'Booking',
    description: 'Reserva de habitaciones y check-in en línea del hotel.',
    industries: ['hospitality'],
  },
];
