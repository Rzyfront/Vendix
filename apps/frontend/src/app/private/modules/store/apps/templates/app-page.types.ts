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
  /** F6-B: WhatsApp number with country code, its first message and the floating button. */
  whatsapp_number?: string;
  whatsapp_message?: string;
  whatsapp_floating?: boolean;
}

// ---------------------------------------------------------------------------
// Apps F3 — style tokens (`page.theme`). Closed catalogs mirror the backend.
// ---------------------------------------------------------------------------

export type AppThemeRadius = 'none' | 'small' | 'medium' | 'large';
export type AppThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type AppThemeButtonStyle = 'solid' | 'outline';
export type AppThemeImageStyle = 'square' | 'rounded';
export type AppThemeContentWidth = 'narrow' | 'normal' | 'wide';
// Apps F7 — extended tokens.
export type AppThemeFontSize = 'sm' | 'md' | 'lg';
export type AppThemeHeadingScale = 'compact' | 'normal' | 'display';
export type AppThemeSectionGap = 'tight' | 'normal' | 'airy';
export type AppThemeCardStyle = 'flat' | 'outline' | 'soft';
export type AppThemeShadow = 'none' | 'soft' | 'strong';
export type AppThemeImageRatio = 'square' | '4:3' | '16:9' | 'auto';
export type AppThemeHeroHeight = 'auto' | 'compact' | 'full';
/** Max opacity (%) of the veil over hero and gallery images (mirrors the backend). */
export const APP_THEME_MAX_IMAGE_OVERLAY = 80;

/** Style tokens of a page. Every token is optional: a missing one keeps today's look. */
export interface AppPageTheme {
  primary_color?: string;
  secondary_color?: string;
  surface_color?: string;
  text_color?: string;
  accent_color?: string;
  heading_font?: AppPageFont;
  body_font?: AppPageFont;
  radius?: AppThemeRadius;
  density?: AppThemeDensity;
  button_style?: AppThemeButtonStyle;
  image_style?: AppThemeImageStyle;
  content_width?: AppThemeContentWidth;
  border_color?: string;
  base_font_size?: AppThemeFontSize;
  heading_scale?: AppThemeHeadingScale;
  section_gap?: AppThemeSectionGap;
  card_style?: AppThemeCardStyle;
  shadow?: AppThemeShadow;
  image_ratio?: AppThemeImageRatio;
  /** Opacity (0..80 %) of the veil over hero and gallery images. */
  image_overlay?: number;
  hero_height?: AppThemeHeroHeight;
}

export type AppThemeColorKey =
  | 'primary_color'
  | 'secondary_color'
  | 'surface_color'
  | 'text_color'
  | 'accent_color'
  | 'border_color';

export const APP_THEME_COLORS: readonly { key: AppThemeColorKey; label: string; hint: string }[] = [
  { key: 'primary_color', label: 'Principal', hint: 'Botones y llamados a la acción.' },
  { key: 'secondary_color', label: 'Secundario', hint: 'Degradado de la portada.' },
  { key: 'surface_color', label: 'Fondo', hint: 'Fondo de la página.' },
  { key: 'text_color', label: 'Texto', hint: 'Títulos y párrafos.' },
  { key: 'accent_color', label: 'Acento', hint: 'Estrellas, enlaces y detalles.' },
];

/** Apps F7 — border color, edited apart from the five palette colors. */
export const APP_THEME_BORDER_COLOR: { key: AppThemeColorKey; label: string; hint: string } = {
  key: 'border_color',
  label: 'Bordes',
  hint: 'Líneas de tarjetas y separadores.',
};

/** The five palette colors a quick palette sets at once. */
export type AppThemePaletteKey = Exclude<AppThemeColorKey, 'border_color'>;

/**
 * Quick palettes of the style panel: each sets the five palette colors at
 * once. Every pair checked by `contrastChecks` stays at 4.5:1 or more.
 */
export const APP_THEME_PALETTES: readonly {
  id: string;
  name: string;
  colors: Record<AppThemePaletteKey, string>;
}[] = [
  {
    id: 'ocean',
    name: 'Océano',
    colors: {
      primary_color: '#1D4ED8',
      secondary_color: '#1E3A8A',
      surface_color: '#F8FAFC',
      text_color: '#0F172A',
      accent_color: '#0369A1',
    },
  },
  {
    id: 'forest',
    name: 'Bosque',
    colors: {
      primary_color: '#166534',
      secondary_color: '#14532D',
      surface_color: '#F7FAF5',
      text_color: '#1C2A1E',
      accent_color: '#3F6212',
    },
  },
  {
    id: 'terracotta',
    name: 'Terracota',
    colors: {
      primary_color: '#9A3412',
      secondary_color: '#7C2D12',
      surface_color: '#FFF8F1',
      text_color: '#2A1A12',
      accent_color: '#9A3412',
    },
  },
  {
    id: 'night',
    name: 'Noche',
    colors: {
      primary_color: '#FBBF24',
      secondary_color: '#F59E0B',
      surface_color: '#0F172A',
      text_color: '#F1F5F9',
      accent_color: '#FCD34D',
    },
  },
];

export type AppThemeOptionKey = 'radius' | 'density' | 'button_style' | 'image_style' | 'content_width';

/** Apps F7 — the extended closed tokens (style panel of product, service and booking pages). */
export type AppThemeExtendedOptionKey =
  | 'base_font_size'
  | 'heading_scale'
  | 'section_gap'
  | 'card_style'
  | 'shadow'
  | 'image_ratio'
  | 'hero_height';

/** Group of the style panel an option belongs to. */
export type AppThemeOptionGroup = 'typography' | 'spacing' | 'images';

/** Group of each original (F3) option in the regrouped style panel. */
export const APP_THEME_OPTION_GROUPS: Record<AppThemeOptionKey, AppThemeOptionGroup> = {
  radius: 'spacing',
  density: 'spacing',
  button_style: 'spacing',
  image_style: 'images',
  content_width: 'spacing',
};

/** The closed choices of each non-color token, with their editor labels. */
export const APP_THEME_OPTIONS: readonly {
  key: AppThemeOptionKey;
  label: string;
  values: readonly { value: string; label: string }[];
}[] = [
  {
    key: 'radius',
    label: 'Esquinas',
    values: [
      { value: 'none', label: 'Rectas' },
      { value: 'small', label: 'Suaves' },
      { value: 'medium', label: 'Redondeadas' },
      { value: 'large', label: 'Muy redondeadas' },
    ],
  },
  {
    key: 'density',
    label: 'Espaciado',
    values: [
      { value: 'compact', label: 'Compacta' },
      { value: 'comfortable', label: 'Cómoda' },
      { value: 'spacious', label: 'Amplia' },
    ],
  },
  {
    key: 'button_style',
    label: 'Botones',
    values: [
      { value: 'solid', label: 'Sólido' },
      { value: 'outline', label: 'Contorno' },
    ],
  },
  {
    key: 'image_style',
    label: 'Imágenes',
    values: [
      { value: 'square', label: 'Esquinas rectas' },
      { value: 'rounded', label: 'Redondeadas' },
    ],
  },
  {
    key: 'content_width',
    label: 'Ancho del contenido',
    values: [
      { value: 'narrow', label: 'Angosto' },
      { value: 'normal', label: 'Normal' },
      { value: 'wide', label: 'Amplio' },
    ],
  },
];

/** Apps F7 — closed choices of the extended tokens, with their group and labels. */
export const APP_THEME_EXTENDED_OPTIONS: readonly {
  key: AppThemeExtendedOptionKey;
  group: AppThemeOptionGroup;
  label: string;
  values: readonly { value: string; label: string }[];
}[] = [
  {
    key: 'base_font_size',
    group: 'typography',
    label: 'Tamaño del texto',
    values: [
      { value: 'sm', label: 'Pequeño' },
      { value: 'md', label: 'Normal' },
      { value: 'lg', label: 'Grande' },
    ],
  },
  {
    key: 'heading_scale',
    group: 'typography',
    label: 'Tamaño de los títulos',
    values: [
      { value: 'compact', label: 'Compactos' },
      { value: 'normal', label: 'Normales' },
      { value: 'display', label: 'Destacados' },
    ],
  },
  {
    key: 'section_gap',
    group: 'spacing',
    label: 'Espacio entre secciones',
    values: [
      { value: 'tight', label: 'Junto' },
      { value: 'normal', label: 'Normal' },
      { value: 'airy', label: 'Aireado' },
    ],
  },
  {
    key: 'card_style',
    group: 'spacing',
    label: 'Tarjetas',
    values: [
      { value: 'flat', label: 'Planas' },
      { value: 'outline', label: 'Con borde' },
      { value: 'soft', label: 'Suaves' },
    ],
  },
  {
    key: 'shadow',
    group: 'spacing',
    label: 'Sombra de tarjetas',
    values: [
      { value: 'none', label: 'Sin sombra' },
      { value: 'soft', label: 'Suave' },
      { value: 'strong', label: 'Marcada' },
    ],
  },
  {
    key: 'image_ratio',
    group: 'images',
    label: 'Proporción de imágenes',
    values: [
      { value: 'square', label: 'Cuadrada' },
      { value: '4:3', label: '4:3' },
      { value: '16:9', label: '16:9' },
      { value: 'auto', label: 'Original' },
    ],
  },
  {
    key: 'hero_height',
    group: 'images',
    label: 'Alto de la portada',
    values: [
      { value: 'auto', label: 'Automático' },
      { value: 'compact', label: 'Compacta' },
      { value: 'full', label: 'Pantalla completa' },
    ],
  },
];

export interface AppPageSeo {
  title?: string;
  description?: string;
  image_url?: string;
}

// ---------------------------------------------------------------------------
// Apps sections — variantes por sección y apariencia opcional de bloque
// ---------------------------------------------------------------------------

export type AppHeroVariant = 'centered' | 'image_right' | 'background';
export type AppHeroHeight = 'auto' | 'compact' | 'full';
export type AppGalleryVariant = 'grid' | 'carousel' | 'mosaic';
export type AppGalleryAspectRatio = '1:1' | '4:3' | '16:9';
export type AppHighlightsVariant = 'cards' | 'list' | 'band';
export type AppBlockSpacing = 'compact' | 'normal' | 'spacious';
export type AppTextAlign = 'left' | 'center' | 'right';
export type AppHighlightsIcon =
  | 'sparkles'
  | 'star'
  | 'check'
  | 'shield-check'
  | 'truck'
  | 'clock'
  | 'heart'
  | 'award'
  | 'zap'
  | 'flame'
  | 'gift'
  | 'map-pin'
  | 'crown'
  | 'thumbs-up';

export interface FieldOption {
  value: string;
  label: string;
}

export const APP_HERO_VARIANT_OPTIONS: readonly FieldOption[] = [
  { value: 'centered', label: 'Centrado' },
  { value: 'image_right', label: 'Imagen a la derecha' },
  { value: 'background', label: 'Imagen de fondo' },
];

export const APP_HERO_HEIGHT_OPTIONS: readonly FieldOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'compact', label: 'Compacto' },
  { value: 'full', label: 'Completo' },
];

export const APP_GALLERY_VARIANT_OPTIONS: readonly FieldOption[] = [
  { value: 'grid', label: 'Cuadrícula' },
  { value: 'carousel', label: 'Carrusel' },
  { value: 'mosaic', label: 'Mosaico' },
];

export const APP_GALLERY_ASPECT_OPTIONS: readonly FieldOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
];

export const APP_HIGHLIGHTS_VARIANT_OPTIONS: readonly FieldOption[] = [
  { value: 'cards', label: 'Tarjetas' },
  { value: 'list', label: 'Lista' },
  { value: 'band', label: 'Banda' },
];

export const APP_HIGHLIGHTS_ICON_OPTIONS: readonly FieldOption[] = [
  { value: 'sparkles', label: 'Destello' },
  { value: 'star', label: 'Estrella' },
  { value: 'check', label: 'Verificado' },
  { value: 'shield-check', label: 'Garantía' },
  { value: 'truck', label: 'Envío' },
  { value: 'clock', label: 'Rapidez' },
  { value: 'heart', label: 'Favorito' },
  { value: 'award', label: 'Calidad' },
  { value: 'zap', label: 'Energía' },
  { value: 'flame', label: 'Destacado' },
  { value: 'gift', label: 'Beneficio' },
  { value: 'map-pin', label: 'Ubicación' },
  { value: 'crown', label: 'Premium' },
  { value: 'thumbs-up', label: 'Recomendado' },
];

export const APP_BLOCK_SPACING_OPTIONS: readonly FieldOption[] = [
  { value: 'compact', label: 'Compacto' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Amplio' },
];

export const APP_TEXT_ALIGN_OPTIONS: readonly FieldOption[] = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centrado' },
  { value: 'right', label: 'Derecha' },
];

export interface AppPageHero {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  image_url?: string;
  button_label?: string;
  variant?: AppHeroVariant;
  background_image_url?: string;
  overlay_opacity?: number;
  height?: AppHeroHeight;
  align?: AppTextAlign;
}

/** `store_apps.config.page`. Every field but the version and blocks is optional. */
export interface AppPageDocument {
  schema_version: typeof APP_PAGE_SCHEMA_VERSION;
  mode?: AppPageMode;
  sales?: AppPageSales;
  booking?: AppPageBooking;
  brand?: AppPageBrand;
  seo?: AppPageSeo;
  /** Apps F3: style tokens. Absent = the page looks exactly as before F3. */
  theme?: AppPageTheme;
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
  | { key: string; label: string; kind: 'text'; max: number; multiline?: boolean; placeholder?: string; group?: 'appearance' }
  | { key: string; label: string; kind: 'url'; placeholder?: string; group?: 'appearance' }
  | { key: string; label: string; kind: 'media'; placeholder?: string; hint?: string; group?: 'appearance' }
  | { key: string; label: string; kind: 'color'; placeholder?: string; hint?: string; group?: 'appearance' }
  | {
      key: string;
      label: string;
      kind: 'select';
      options: readonly FieldOption[];
      display?: 'select' | 'chips';
      emptyLabel?: string;
      hint?: string;
      group?: 'appearance';
    }
  | {
      key: string;
      label: string;
      kind: 'range';
      min: number;
      max: number;
      step?: number;
      unit?: string;
      defaultValue?: number;
      defaultByProp?: { key: string; values: Readonly<Record<string, number>> };
      hint?: string;
      group?: 'appearance';
    }
  | { key: string; label: string; kind: 'bool'; group?: 'appearance' }
  | { key: string; label: string; kind: 'int'; min: number; max: number; group?: 'appearance' };

export type FieldDef =
  | ScalarFieldDef
  | { key: string; label: string; kind: 'list'; max: number; itemLabel: string; item: ScalarFieldDef[] }
  | { key: string; label: string; kind: 'text_list'; max: number; itemMax: number }
  | { key: string; label: string; kind: 'url_list'; max: number }
  | { key: string; label: string; kind: 'media_list'; max: number };

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

/**
 * Apps F3 — one ready-made page of an app: the base or a variant. Variants are
 * data only: same block catalog and same contract as the base, with another
 * order, emphasis and default `theme`.
 */
export interface AppPageVariant {
  /** `base` for the app's base page; a slug for the variants. */
  id: string;
  name: string;
  description: string;
  /** Hero, blocks and theme to use. Mode, sales, booking, brand and SEO are kept. */
  page: AppPageDocument;
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

/** Campos comunes de apariencia opcional para cualquier bloque (excepto store_home). */
export const BLOCK_APPEARANCE_FIELDS: readonly ScalarFieldDef[] = [
  {
    key: 'background_color',
    label: 'Color de fondo',
    kind: 'color',
    placeholder: 'Sin color propio',
    group: 'appearance',
  },
  {
    key: 'background_image_url',
    label: 'Imagen de fondo',
    kind: 'media',
    hint: 'Se muestra detrás del contenido de la sección.',
    group: 'appearance',
  },
  {
    key: 'overlay_opacity',
    label: 'Intensidad del velo',
    kind: 'range',
    min: 0,
    max: 80,
    step: 5,
    unit: '%',
    defaultValue: 40,
    hint: 'Oscurece la imagen de fondo para mejorar la lectura.',
    group: 'appearance',
  },
  {
    key: 'spacing',
    label: 'Espaciado',
    kind: 'select',
    display: 'chips',
    options: APP_BLOCK_SPACING_OPTIONS,
    emptyLabel: 'Por defecto',
    group: 'appearance',
  },
  {
    key: 'align',
    label: 'Alineación',
    kind: 'select',
    display: 'chips',
    options: APP_TEXT_ALIGN_OPTIONS,
    emptyLabel: 'Por defecto',
    group: 'appearance',
  },
];

/** Campos configurables de bloques de destacados/beneficios (variantes, imagen, icono y acento). */
export const highlightsFields = (itemLabel = 'Destacado'): FieldDef[] => [
  titleField(),
  {
    key: 'variant',
    label: 'Diseño',
    kind: 'select',
    display: 'chips',
    options: APP_HIGHLIGHTS_VARIANT_OPTIONS,
    emptyLabel: 'Por defecto',
  },
  {
    key: 'accent_color',
    label: 'Color de acento',
    kind: 'color',
    placeholder: 'Color de la página',
  },
  {
    key: 'items',
    label: itemLabel === 'Beneficio' ? 'Beneficios' : 'Destacados',
    kind: 'list',
    max: 6,
    itemLabel,
    item: [
      { key: 'title', label: 'Título', kind: 'text', max: 60 },
      { key: 'text', label: 'Texto', kind: 'text', max: 240, multiline: true },
      { key: 'image_url', label: 'Imagen', kind: 'media' },
      {
        key: 'icon',
        label: 'Icono',
        kind: 'select',
        display: 'select',
        options: APP_HIGHLIGHTS_ICON_OPTIONS,
        emptyLabel: 'Sin icono',
      },
    ],
  },
];

export const galleryFields = (): FieldDef[] => [
  titleField(),
  {
    key: 'variant',
    label: 'Diseño',
    kind: 'select',
    display: 'chips',
    options: APP_GALLERY_VARIANT_OPTIONS,
    emptyLabel: 'Por defecto',
  },
  {
    key: 'columns',
    label: 'Columnas',
    kind: 'range',
    min: 2,
    max: 4,
    step: 1,
    unit: ' col.',
    defaultValue: 3,
  },
  {
    key: 'aspect_ratio',
    label: 'Proporción',
    kind: 'select',
    display: 'chips',
    options: APP_GALLERY_ASPECT_OPTIONS,
    emptyLabel: 'Por defecto',
  },
  { key: 'image_urls', label: 'Imágenes', kind: 'media_list', max: 12 },
];

export const ctaFields = (): FieldDef[] => [
  titleField(),
  { key: 'text', label: 'Texto', kind: 'text', max: 300, multiline: true },
  { key: 'button_label', label: 'Texto del botón', kind: 'text', max: 40 },
  { key: 'image_url', label: 'Imagen', kind: 'media' },
];

/** Hero fields, common to every app page. */
export const HERO_FIELDS: ScalarFieldDef[] = [
  { key: 'eyebrow', label: 'Antetítulo', kind: 'text', max: 60 },
  { key: 'title', label: 'Título', kind: 'text', max: 120 },
  { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 300, multiline: true },
  { key: 'image_url', label: 'Imagen', kind: 'url' },
  { key: 'button_label', label: 'Texto del botón', kind: 'text', max: 40 },
];

/** Portada editable con galería y variantes (Product Page, Service Page y Booking). */
export const HERO_CUSTOM_FIELDS: ScalarFieldDef[] = [
  {
    key: 'variant',
    label: 'Diseño de la portada',
    kind: 'select',
    display: 'chips',
    options: APP_HERO_VARIANT_OPTIONS,
    emptyLabel: 'Por defecto',
  },
  { key: 'eyebrow', label: 'Antetítulo', kind: 'text', max: 60 },
  { key: 'title', label: 'Título', kind: 'text', max: 120 },
  { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 300, multiline: true },
  { key: 'image_url', label: 'Imagen principal', kind: 'media' },
  { key: 'button_label', label: 'Texto del botón', kind: 'text', max: 40 },
  {
    key: 'background_image_url',
    label: 'Imagen de fondo',
    kind: 'media',
    hint: 'Se muestra detrás de la portada con el velo configurado.',
    group: 'appearance',
  },
  {
    key: 'overlay_opacity',
    label: 'Intensidad del velo',
    kind: 'range',
    min: 0,
    max: 80,
    step: 5,
    unit: '%',
    defaultValue: 40,
    defaultByProp: { key: 'variant', values: { background: 45 } },
    group: 'appearance',
  },
  {
    key: 'height',
    label: 'Alto',
    kind: 'select',
    display: 'chips',
    options: APP_HERO_HEIGHT_OPTIONS,
    emptyLabel: 'Por defecto',
    group: 'appearance',
  },
  {
    key: 'align',
    label: 'Alineación del texto',
    kind: 'select',
    display: 'chips',
    options: APP_TEXT_ALIGN_OPTIONS,
    emptyLabel: 'Por defecto',
    group: 'appearance',
  },
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
