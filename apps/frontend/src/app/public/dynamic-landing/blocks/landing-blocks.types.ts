/**
 * Contrato TS espejo de `apps/backend/src/domains/store/crm/crm-blocks.contract.ts`.
 * Fuente compartida del editor (panel) y del render público (STORE_LANDING).
 */
export const CRM_LANDING_SCHEMA_VERSION = 1;

export const CRM_BLOCK_TYPES = [
  'hero',
  'features',
  'products_grid',
  'store_gallery',
  'testimonials',
  'faq',
  'location_hours',
  'promo_banner',
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
  whatsapp_number?: string;
  whatsapp_message?: string;
  border_radius?: 'rounded-lg' | 'rounded-2xl' | 'rounded-full';
  enable_whatsapp_float?: boolean;
}

export interface CrmLandingDocument {
  schema_version: typeof CRM_LANDING_SCHEMA_VERSION;
  theme?: CrmLandingTheme;
  blocks: CrmBlock[];
}

export const CRM_BLOCK_LABELS: Record<CrmBlockType, string> = {
  hero: 'Portada de Impacto',
  features: 'Beneficios y Valor',
  products_grid: 'Productos Destacados',
  store_gallery: 'Fotos del Local y Vitrina',
  testimonials: 'Reseñas y Testimonios',
  faq: 'Preguntas Frecuentes',
  location_hours: 'Ubicación y Horarios',
  promo_banner: 'Banner Promocional',
  about: 'Sobre el Negocio',
  contact: 'Formulario de Contacto',
  footer_cta: 'Cierre de Conversión',
};

export interface CrmBlockMeta {
  type: CrmBlockType;
  label: string;
  description: string;
  icon: string;
  category: 'core' | 'trust' | 'commerce' | 'conversion';
}

export const CRM_BLOCK_CATALOG: CrmBlockMeta[] = [
  {
    type: 'hero',
    label: 'Portada de Impacto',
    description: 'Cabecera principal con badge, gran título, doble CTA y métricas de confianza.',
    icon: 'sparkles',
    category: 'core',
  },
  {
    type: 'store_gallery',
    label: 'Fotos del Local y Vitrina',
    description: 'Muestra fotos reales de tu tienda física, vitrinas, showroom o productos en uso.',
    icon: 'image',
    category: 'trust',
  },
  {
    type: 'products_grid',
    label: 'Catálogo de Productos',
    description: 'Grilla de productos sincronizados de tu tienda con fotos, precios COP y compra directa.',
    icon: 'shopping-bag',
    category: 'commerce',
  },
  {
    type: 'features',
    label: 'Beneficios y Garantías',
    description: 'Tarjetas con iconos modernos destacando rapidez, garantía y atención.',
    icon: 'shield-check',
    category: 'trust',
  },
  {
    type: 'testimonials',
    label: 'Reseñas de Clientes',
    description: 'Prueba social con calificaciones de 5 estrellas, comentarios y fotos de clientes.',
    icon: 'star',
    category: 'trust',
  },
  {
    type: 'promo_banner',
    label: 'Banner Promocional',
    description: 'Destaca ofertas temporales, descuentos exclusivos o envíos gratis.',
    icon: 'tag',
    category: 'commerce',
  },
  {
    type: 'faq',
    label: 'Preguntas Frecuentes',
    description: 'Acordeón interactivo para resolver dudas sobre pagos, envíos y garantías.',
    icon: 'help-circle',
    category: 'trust',
  },
  {
    type: 'location_hours',
    label: 'Ubicación y Horarios',
    description: 'Punto físico, horarios de atención y botones directos a Google Maps / Waze.',
    icon: 'map-pin',
    category: 'trust',
  },
  {
    type: 'about',
    label: 'Historia y Autoridad',
    description: 'Historia de tu negocio, valores y tarjeta de respaldo comercial y legal.',
    icon: 'building',
    category: 'core',
  },
  {
    type: 'contact',
    label: 'Formulario de Contacto',
    description: 'Captura clientes y mensajes directos que llegan a tu bandeja de entrada.',
    icon: 'mail',
    category: 'conversion',
  },
  {
    type: 'footer_cta',
    label: 'Llamado Final',
    description: 'Bloque final con gradiente profundo y botón de alta conversión.',
    icon: 'zap',
    category: 'conversion',
  },
];

/** Campos editables por tipo. */
export interface CrmBlockFieldConfig {
  key: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}

export const CRM_BLOCK_FIELDS: Record<CrmBlockType, CrmBlockFieldConfig[]> = {
  hero: [
    { key: 'badge', label: 'Insignia superior (Badge)', placeholder: '✨ Tecnología y Calidad' },
    { key: 'title', label: 'Título principal' },
    { key: 'subtitle', label: 'Subtítulo', multiline: true },
    { key: 'cta_label', label: 'Texto del botón principal', placeholder: 'Ver catálogo de productos' },
    { key: 'secondary_cta_label', label: 'Texto botón secundario', placeholder: 'Contactar un asesor' },
  ],
  store_gallery: [
    { key: 'title', label: 'Título de la galería', placeholder: 'Nuestras Instalaciones y Vitrinas' },
    { key: 'subtitle', label: 'Subtítulo descriptivo', placeholder: 'Visítanos en nuestro punto de atención en Bogotá' },
    {
      key: 'images',
      label: 'Fotos de la tienda (URLs o Título | URL)',
      multiline: true,
      placeholder: 'Vitrina Principal | https://images.unsplash.com/...\nShowroom | https://images.unsplash.com/...',
      hint: 'Una imagen por línea con formato opcional: Título | URL',
    },
  ],
  features: [
    { key: 'title', label: 'Título de la sección' },
    {
      key: 'items',
      label: 'Beneficios',
      multiline: true,
      placeholder: 'Envíos rápidos | Recibe en 24h\nGarantía real | Todos nuestros productos cuentan con respaldo directo',
      hint: 'Un beneficio por línea con formato: Título | Descripción',
    },
  ],
  products_grid: [
    { key: 'title', label: 'Título de la sección', placeholder: 'Lo más destacado de nuestro catálogo' },
    { key: 'subtitle', label: 'Subtítulo', placeholder: 'Explora nuestra selección con garantía directa' },
  ],
  testimonials: [
    { key: 'title', label: 'Título de la sección', placeholder: 'Lo que dicen nuestros clientes' },
    { key: 'subtitle', label: 'Subtítulo', placeholder: 'Cientos de clientes satisfechos respaldan nuestro servicio' },
    {
      key: 'items',
      label: 'Testimonios',
      multiline: true,
      placeholder: 'Andrés Gómez | Bogotá | Excelente atención y los equipos llegaron sellados y con factura.\nLaura Pérez | Medellín | Compré un portátil para mi trabajo y el soporte técnico fue impecable.',
      hint: 'Un testimonio por línea con formato: Nombre | Ciudad o Rol | Comentario',
    },
  ],
  promo_banner: [
    { key: 'badge', label: 'Insignia promocional', placeholder: '⚡ Oferta Especial del Mes' },
    { key: 'title', label: 'Título de la promoción', placeholder: '¡Aprovecha hasta 20% de descuento!' },
    { key: 'subtitle', label: 'Descripción de la oferta', multiline: true, placeholder: 'En referencias seleccionadas de tecnología y accesorios. Válido hasta agotar existencias.' },
    { key: 'cta_label', label: 'Texto del botón', placeholder: 'Ver ofertas ahora' },
  ],
  faq: [
    { key: 'title', label: 'Título de la sección', placeholder: 'Preguntas Frecuentes' },
    { key: 'subtitle', label: 'Subtítulo', placeholder: 'Resolvemos tus dudas principales antes de comprar' },
    {
      key: 'items',
      label: 'Preguntas y Respuestas',
      multiline: true,
      placeholder: '¿Qué métodos de pago aceptan? | Aceptamos transferencias Nequi, Daviplata, tarjetas crédito/débito y pago contraentrega.\n¿Tienen tienda física? | Sí, contamos con punto de atención físico donde puedes probar los equipos.\n¿Los productos tienen garantía? | Absolutamente, todos los productos cuentan con garantía directa y factura oficial.',
      hint: 'Una pregunta por línea con formato: Pregunta | Respuesta',
    },
  ],
  location_hours: [
    { key: 'title', label: 'Título de la sección', placeholder: 'Visítanos en nuestro punto de venta' },
    { key: 'address', label: 'Dirección física', placeholder: 'Carrera 15 # 93-60, Chicó, Bogotá' },
    { key: 'hours', label: 'Horarios de atención', placeholder: 'Lunes a Sábado: 9:00 AM - 7:00 PM | Domingos: 10:00 AM - 3:00 PM' },
    { key: 'phone', label: 'Teléfono / WhatsApp de atención', placeholder: '+57 300 123 4567' },
    { key: 'maps_url', label: 'Enlace a Google Maps / Waze', placeholder: 'https://maps.google.com' },
  ],
  about: [
    { key: 'title', label: 'Título', placeholder: 'Conoce nuestra historia y compromiso' },
    { key: 'body', label: 'Historia del negocio', multiline: true },
  ],
  contact: [
    { key: 'title', label: 'Título', placeholder: 'Visítanos o escríbenos directamente' },
    { key: 'description', label: 'Descripción', multiline: true },
  ],
  footer_cta: [
    { key: 'title', label: 'Título', placeholder: 'Equípate hoy mismo con lo mejor' },
    { key: 'subtitle', label: 'Subtítulo', placeholder: 'Consulta disponibilidad inmediata o visítanos hoy mismo' },
    { key: 'cta_label', label: 'Texto del botón', placeholder: 'Explorar productos ahora' },
  ],
};

/** Documento de arranque cuando aún no hay contenido generado/editado. */
export function emptyCrmLandingDocument(): CrmLandingDocument {
  return {
    schema_version: CRM_LANDING_SCHEMA_VERSION,
    theme: {
      primary_color: '#1E40AF',
      secondary_color: '#0F172A',
      enable_whatsapp_float: true,
      border_radius: 'rounded-2xl',
    },
    blocks: [],
  };
}

/** Estado visible del ciclo de generación (espejo del backend). */
export type LandingStatus = 'idle' | 'pending' | 'generating' | 'ready' | 'failed';

