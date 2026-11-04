import type { BuilderCatalog, BuilderOperationMode } from '../builder/builder.types';

/**
 * F6-A — the landing's block catalog for the page builder engine. Each entry
 * maps one block the public landing already renders
 * (`public/dynamic-landing/blocks`) to its editor fields; the keys are the
 * props those components read. Lists are edited as items; older documents
 * (multiline `a | b` text or the generator's aliased keys) are read as items
 * and written back with the canonical keys.
 *
 * Landing orientation: general promotion, with every kind of modular block.
 * It runs in `both` mode, so the whole catalog applies; the per-mode filter of
 * the engine is what the service, product and booking pages will use.
 */
export const LANDING_OPERATION_MODE: BuilderOperationMode = 'both';

/** Same cap as the backend contract (`crm-blocks.contract.ts`, MAX_BLOCKS). */
export const LANDING_MAX_BLOCKS = 20;

export const LANDING_BUILDER_CATALOG: BuilderCatalog = {
  appKind: 'landing',
  maxBlocks: LANDING_MAX_BLOCKS,
  categories: [
    { id: 'core', label: 'Esenciales' },
    { id: 'trust', label: 'Confianza' },
    { id: 'commerce', label: 'Venta' },
    { id: 'conversion', label: 'Conversión' },
  ],
  blocks: [
    {
      type: 'hero',
      label: 'Portada',
      description: 'Primera pantalla: insignia, gran título, subtítulo y dos botones.',
      icon: 'sparkles',
      category: 'core',
      single: true,
      fields: [
        { key: 'badge', label: 'Insignia', kind: 'text', max: 60, placeholder: '✨ Tecnología y calidad' },
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Lo mejor para tu hogar, con garantía' },
        { key: 'subtitle', label: 'Subtítulo', kind: 'textarea', max: 300 },
        { key: 'cta_label', label: 'Botón principal', kind: 'text', max: 40, placeholder: 'Ver catálogo de productos', hint: 'Lleva a tu tienda en línea.' },
        { key: 'secondary_cta_label', label: 'Botón secundario', kind: 'text', max: 40, placeholder: 'Contactar un asesor', hint: 'Lleva al formulario de contacto.' },
      ],
    },
    {
      type: 'about',
      label: 'Sobre el negocio',
      description: 'Tu historia, valores y respaldo comercial.',
      icon: 'building',
      category: 'core',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Conoce nuestra historia y compromiso' },
        { key: 'body', label: 'Historia', kind: 'textarea', max: 1200 },
      ],
    },
    {
      type: 'features',
      label: 'Beneficios',
      description: 'Tarjetas con lo que te diferencia: envío, garantía, atención.',
      icon: 'shield-check',
      category: 'trust',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120 },
        {
          key: 'items',
          label: 'Beneficios',
          kind: 'list',
          itemLabel: 'Beneficio',
          max: 8,
          item: [
            { key: 'title', label: 'Título', kind: 'text', max: 80, placeholder: 'Envíos rápidos' },
            { key: 'description', label: 'Descripción', kind: 'textarea', max: 240, placeholder: 'Recibe en 24 horas' },
          ],
          aliases: { title: ['name'], description: ['desc'] },
        },
      ],
    },
    {
      type: 'store_gallery',
      label: 'Galería del local',
      description: 'Fotos reales de tu tienda, vitrinas o productos en uso.',
      icon: 'image',
      category: 'trust',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Nuestras instalaciones' },
        { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 },
        {
          key: 'images',
          label: 'Fotos',
          kind: 'list',
          itemLabel: 'Foto',
          max: 12,
          item: [
            { key: 'url', label: 'URL de la imagen (https)', kind: 'url', placeholder: 'https://…' },
            { key: 'title', label: 'Pie de foto', kind: 'text', max: 80 },
          ],
          emptyHint: 'Sin fotos propias la página muestra fotos de ejemplo.',
        },
      ],
    },
    {
      type: 'testimonials',
      label: 'Testimonios',
      description: 'Prueba social: lo que dicen tus clientes.',
      icon: 'star',
      category: 'trust',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Lo que dicen nuestros clientes' },
        { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 },
        {
          key: 'items',
          label: 'Testimonios',
          kind: 'list',
          itemLabel: 'Testimonio',
          max: 12,
          item: [
            { key: 'name', label: 'Nombre', kind: 'text', max: 60 },
            { key: 'role', label: 'Ciudad o rol', kind: 'text', max: 60 },
            { key: 'comment', label: 'Comentario', kind: 'textarea', max: 400 },
          ],
          aliases: { name: ['author'], role: ['city'], comment: ['quote', 'description'] },
          emptyHint: 'Sin testimonios propios la página muestra testimonios de ejemplo.',
        },
      ],
    },
    {
      type: 'faq',
      label: 'Preguntas frecuentes',
      description: 'Resuelve dudas de pagos, envíos y garantías.',
      icon: 'help-circle',
      category: 'trust',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Preguntas frecuentes' },
        { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 },
        {
          key: 'items',
          label: 'Preguntas',
          kind: 'list',
          itemLabel: 'Pregunta',
          max: 15,
          item: [
            { key: 'question', label: 'Pregunta', kind: 'text', max: 160 },
            { key: 'answer', label: 'Respuesta', kind: 'textarea', max: 600 },
          ],
          aliases: { question: ['title'], answer: ['description'] },
          emptyHint: 'Sin preguntas propias la página muestra preguntas de ejemplo.',
        },
      ],
    },
    {
      type: 'location_hours',
      label: 'Ubicación y horarios',
      description: 'Dirección, horarios, teléfono y enlace al mapa.',
      icon: 'map-pin',
      category: 'trust',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Visítanos' },
        { key: 'address', label: 'Dirección', kind: 'text', max: 200, placeholder: 'Carrera 15 # 93-60, Bogotá' },
        { key: 'hours', label: 'Horarios', kind: 'text', max: 200, placeholder: 'Lunes a sábado: 9:00 a. m. - 7:00 p. m.' },
        { key: 'phone', label: 'Teléfono o WhatsApp', kind: 'text', max: 40, placeholder: '+57 300 123 4567' },
        { key: 'maps_url', label: 'Enlace a Google Maps o Waze', kind: 'url', placeholder: 'https://maps.google.com/…' },
      ],
    },
    {
      type: 'products_grid',
      label: 'Productos destacados',
      description: 'Tus productos más vendidos, con foto y precio, enlazados a tu tienda.',
      icon: 'shopping-bag',
      category: 'commerce',
      modes: ['sales', 'both'],
      liveData: 'Los productos salen solos de tu catálogo: los más vendidos de los últimos 90 días.',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Lo más destacado de nuestro catálogo' },
        { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 },
      ],
    },
    {
      type: 'promo_banner',
      label: 'Banner promocional',
      description: 'Una oferta temporal, descuento o envío gratis.',
      icon: 'tag',
      category: 'commerce',
      fields: [
        { key: 'badge', label: 'Insignia', kind: 'text', max: 60, placeholder: '⚡ Oferta del mes' },
        { key: 'title', label: 'Título', kind: 'text', max: 120 },
        { key: 'subtitle', label: 'Descripción', kind: 'textarea', max: 300 },
        { key: 'cta_label', label: 'Botón', kind: 'text', max: 40, placeholder: 'Ver ofertas', hint: 'Lleva a tu tienda en línea.' },
      ],
    },
    {
      type: 'contact',
      label: 'Formulario de contacto',
      description: 'Captura clientes: cada mensaje llega al CRM.',
      icon: 'mail',
      category: 'conversion',
      single: true,
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120, placeholder: 'Escríbenos' },
        { key: 'description', label: 'Descripción', kind: 'textarea', max: 400 },
      ],
    },
    {
      type: 'footer_cta',
      label: 'Llamado final',
      description: 'Cierre con fondo de color y un botón de alta conversión.',
      icon: 'zap',
      category: 'conversion',
      fields: [
        { key: 'title', label: 'Título', kind: 'text', max: 120 },
        { key: 'subtitle', label: 'Subtítulo', kind: 'text', max: 200 },
        { key: 'cta_label', label: 'Botón', kind: 'text', max: 40, placeholder: 'Explorar productos', hint: 'Lleva a tu tienda en línea.' },
      ],
    },
  ],
};
