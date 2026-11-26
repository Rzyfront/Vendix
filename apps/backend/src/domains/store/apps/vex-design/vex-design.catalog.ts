import {
  APP_HERO_FIELDS,
  APP_PAGE_BLOCKS,
  APP_THEME_FIELDS,
  AppPageDocument,
  FieldSpec,
  FieldsSpec,
  MAX_APP_PAGE_BLOCKS,
  SINGLE_APP_PAGE_BLOCKS,
} from '../shared/app-page.contract';
import { listPresetsForApp } from './vex-design.presets';
import type {
  DesignChatAppKind,
  VexDesignGalleryMediaSummary,
} from './vex-design.types';

/** Etiquetas legibles en español para los tipos de bloque del catálogo. */
export const BLOCK_TYPE_LABELS: Readonly<Record<string, string>> = {
  hero: 'Portada',
  benefits: 'Beneficios',
  highlights: 'Destacados',
  how_it_works: 'Cómo funciona',
  specifications: 'Ficha técnica',
  gallery: 'Galería',
  testimonials: 'Testimonios',
  complements: 'Complementos',
  products: 'Productos',
  shipping_warranty: 'Envío y garantía',
  faq: 'Preguntas frecuentes',
  cta: 'Llamado a la acción',
  services: 'Servicios',
  team: 'Equipo',
  policies: 'Políticas',
  search: 'Buscador',
  stay_detail: 'Detalle de estadía',
  amenities: 'Comodidades',
  location: 'Ubicación',
  checkin_info: 'Check-in en línea',
};

export const APP_KIND_LABELS: Readonly<Record<DesignChatAppKind, string>> = {
  product_page: 'Product page',
  service_page: 'Service page',
  booking: 'Booking (Reservas)',
};

export const THEME_TOKEN_LABELS: Readonly<Record<string, string>> = {
  primary_color: 'color principal',
  secondary_color: 'color secundario',
  surface_color: 'color de fondo',
  text_color: 'color de texto',
  accent_color: 'color de acento',
  border_color: 'color de bordes',
  heading_font: 'tipografía de títulos',
  body_font: 'tipografía de texto',
  radius: 'bordes redondeados',
  density: 'densidad',
  button_style: 'estilo de botones',
  image_style: 'estilo de imágenes',
  content_width: 'ancho del contenido',
  base_font_size: 'tamaño de letra',
  heading_scale: 'escala de títulos',
  section_gap: 'espacio entre secciones',
  card_style: 'estilo de tarjetas',
  shadow: 'sombra',
  image_ratio: 'proporción de imágenes',
  image_overlay: 'velo de imágenes',
  hero_height: 'altura de portada',
};

/** Describe brevemente un campo del contrato para el contexto del modelo. */
function describeField(name: string, spec: FieldSpec): string {
  switch (spec.kind) {
    case 'enum':
      return `${name}(${spec.values.join('|')})`;
    case 'color':
      return `${name}(#RRGGBB)`;
    case 'bool':
      return `${name}(bool)`;
    case 'int':
      return `${name}(${spec.min}..${spec.max})`;
    case 'url':
      return `${name}(media_via_set_block_media)`;
    case 'url_list':
      return `${name}(media_list_via_set_block_media,max:${spec.max})`;
    case 'text':
      return `${name}(texto<= ${spec.max})`;
    case 'text_list':
      return `${name}(lista_texto,max:${spec.max})`;
    case 'id_list':
      return `${name}(lista_ids,max:${spec.max})`;
    case 'conditions':
      return `${name}(${spec.keys.join(',')})`;
    case 'list':
      return `${name}(lista[${Object.keys(spec.item).join(',')}],max:${spec.max})`;
  }
}

function summarizeFieldsSpec(spec: FieldsSpec): string {
  return Object.entries(spec)
    .map(([key, field]) => describeField(key, field))
    .join(', ');
}

/**
 * Construye el contexto estructurado que el servidor inyecta en los turnos del
 * chat de diseño de apps: app abierta, borrador actual, catálogo cerrado de
 * bloques/props, tokens de tema, presets por industria y fotos de la galería.
 */
export function buildDesignChatPromptContext(params: {
  appKind: DesignChatAppKind;
  draft: AppPageDocument;
  galleryImages: VexDesignGalleryMediaSummary[];
}): string {
  const { appKind, draft, galleryImages } = params;
  const catalog = APP_PAGE_BLOCKS[appKind];
  const singleBlocks = SINGLE_APP_PAGE_BLOCKS[appKind];
  const presets = listPresetsForApp(appKind);

  const blockCatalogLines = Object.entries(catalog).map(([type, spec]) => {
    const label = BLOCK_TYPE_LABELS[type] ?? type;
    const singleTag = singleBlocks.includes(type) ? ' [único]' : '';
    return `- ${type} (${label}${singleTag}): ${summarizeFieldsSpec(spec)}`;
  });

  const themeLine = summarizeFieldsSpec(APP_THEME_FIELDS);
  const heroLine = summarizeFieldsSpec(APP_HERO_FIELDS);

  const presetLines = presets.map(
    (p) => `- ${p.id}: ${p.name} (${p.industry}) — ${p.description}`,
  );

  const galleryLines =
    galleryImages.length > 0
      ? galleryImages.map(
          (img) =>
            `- media_id=${img.id}${img.alt ? ` ("${img.alt}")` : ''}${img.app_kind ? ` [${img.app_kind}]` : ''}`,
        )
      : ['- (sin fotos en la galería todavía)'];

  const draftSummary = {
    theme: draft.theme ?? {},
    hero: draft.hero ?? {},
    blocks: draft.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      enabled: b.enabled,
      props: b.props,
    })),
  };

  return [
    `[CONTEXTO DEL EDITOR DE APPS — ${APP_KIND_LABELS[appKind]} (${appKind})]`,
    'REGLAS ESTRICTAS:',
    '1. NUNCA generes HTML ni CSS libre. Solo puedes modificar el borrador usando las herramientas acotadas `vex_design_read`, `vex_design_patch` y `vex_design_discard`.',
    '2. Aplica UNA operación por llamada a `vex_design_patch`. Si la persona pide varios cambios (ej. foto de galería + fondo oscuro), haz llamadas sucesivas de una operación cada una.',
    '3. Nunca inventes props ni tipos de bloque que no estén en el catálogo de abajo.',
    '4. Para poner imágenes usa SIEMPRE `set_block_media` con un `media_id` real de la galería de la tienda. NUNCA inventes ni pegues URLs externas.',
    '5. Tus cambios modifican SOLO el borrador de esta conversación (nunca guardan ni publican la app). Al terminar, responde en español conciso resumiendo los cambios aplicados para que el dueño los revise en la vista previa y pulse «Aplicar» o «Guardar».',
    `6. Máximo ${MAX_APP_PAGE_BLOCKS} bloques en la página. Para editar la portada usa block_id="hero".`,
    '',
    'PORTADA (block_id="hero") — campos permitidos:',
    heroLine,
    '',
    'TOKENS DE TEMA (op="set_theme") — catálogo cerrado:',
    themeLine,
    '',
    'BLOQUES PERMITIDOS EN ESTA APP:',
    ...blockCatalogLines,
    '',
    'PRESETS POR INDUSTRIA (op="apply_preset"):',
    ...presetLines,
    '',
    'IMÁGENES DISPONIBLES EN LA GALERÍA DE LA TIENDA (para op="set_block_media"):',
    ...galleryLines,
    '',
    'BORRADOR ACTUAL:',
    JSON.stringify(draftSummary),
  ].join('\n');
}

export function blockLabel(typeOrId: string): string {
  return BLOCK_TYPE_LABELS[typeOrId] ?? typeOrId;
}
