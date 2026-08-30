/**
 * Contrato TS espejo de `apps/backend/src/domains/store/crm/crm-blocks.contract.ts`.
 * Fuente compartida del editor (panel) y del render público (STORE_LANDING).
 */
export const CRM_LANDING_SCHEMA_VERSION = 1;

export const CRM_BLOCK_TYPES = [
  'hero',
  'features',
  'products_grid',
  'about',
  'contact',
  'footer_cta',
] as const;

export type CrmBlockType = (typeof CRM_BLOCK_TYPES)[number];

export interface CrmBlock {
  id: string;
  type: CrmBlockType;
  props: Record<string, any>;
}

export interface CrmLandingTheme {
  primary_color?: string;
  secondary_color?: string;
}

export interface CrmLandingDocument {
  schema_version: typeof CRM_LANDING_SCHEMA_VERSION;
  theme?: CrmLandingTheme;
  blocks: CrmBlock[];
}

export const CRM_BLOCK_LABELS: Record<CrmBlockType, string> = {
  hero: 'Portada',
  features: 'Beneficios',
  products_grid: 'Productos destacados',
  about: 'Sobre el negocio',
  contact: 'Contacto',
  footer_cta: 'Llamado final',
};

/** Campos editables por tipo (editor v1: props de texto). */
export interface CrmBlockFieldConfig {
  key: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}

export const CRM_BLOCK_FIELDS: Record<CrmBlockType, CrmBlockFieldConfig[]> = {
  hero: [
    { key: 'title', label: 'Título principal' },
    { key: 'subtitle', label: 'Subtítulo', multiline: true },
    { key: 'cta_label', label: 'Texto del botón', placeholder: 'Ver catálogo' },
  ],
  features: [
    { key: 'title', label: 'Título de la sección' },
    {
      key: 'items',
      label: 'Beneficios',
      multiline: true,
      placeholder: 'Envíos rápidos | Recibe en 24h\nGarantía real | …',
      hint: 'Un beneficio por línea con formato: Título | Descripción',
    },
  ],
  products_grid: [
    { key: 'title', label: 'Título de la sección' },
    { key: 'subtitle', label: 'Subtítulo' },
  ],
  about: [
    { key: 'title', label: 'Título' },
    { key: 'body', label: 'Historia del negocio', multiline: true },
  ],
  contact: [
    { key: 'title', label: 'Título' },
    { key: 'description', label: 'Descripción', multiline: true },
  ],
  footer_cta: [
    { key: 'title', label: 'Título' },
    { key: 'subtitle', label: 'Subtítulo' },
    { key: 'cta_label', label: 'Texto del botón', placeholder: 'Compra ahora' },
  ],
};

/** Documento de arranque cuando aún no hay contenido generado/editado. */
export function emptyCrmLandingDocument(): CrmLandingDocument {
  return {
    schema_version: CRM_LANDING_SCHEMA_VERSION,
    theme: {},
    blocks: [],
  };
}

/** Estado visible del ciclo de generación (espejo del backend). */
export type LandingStatus = 'idle' | 'pending' | 'generating' | 'ready' | 'failed';
