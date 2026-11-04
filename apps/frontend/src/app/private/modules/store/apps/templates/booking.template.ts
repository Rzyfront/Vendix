import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageTemplate,
  faqFields,
  galleryFields,
  subtitleField,
  testimonialsFields,
  titleField,
} from './app-page.types';

/**
 * Booking page base (reference: airbnb.com.co, but minimal and for ONE
 * company, not a marketplace). Date and guest search with the real room types
 * and their nightly rate (the store's PMS), amenities, check-in/check-out and
 * cancellation policies, gallery, location, reviews and FAQ.
 *
 * Replace this file to change the booking page base.
 */
export const BOOKING_TEMPLATE: AppPageTemplate = {
  kind: 'booking',
  summary:
    'Una página de reservas minimalista para tu alojamiento: buscador de fechas y huéspedes, tus habitaciones con tarifa por noche, amenidades, políticas de check-in, check-out y cancelación, galería, ubicación y reseñas.',
  reference: 'airbnb.com.co (minimalista, una sola empresa)',
  blocks: [
    {
      type: 'search',
      label: 'Buscador y habitaciones',
      description: 'Fechas, huéspedes y tus habitaciones reales con su tarifa por noche.',
      icon: 'calendar-search',
      existing: true,
      fields: [titleField(), subtitleField()],
    },
    {
      type: 'amenities',
      label: 'Servicios del alojamiento',
      description: 'Wifi, parqueadero, piscina, desayuno…',
      icon: 'wifi',
      fields: [titleField(), { key: 'items', label: 'Servicios', kind: 'text_list', max: 24, itemMax: 60 }],
    },
    {
      type: 'policies',
      label: 'Políticas',
      description: 'Check-in, check-out, cancelación y reglas de la casa.',
      icon: 'shield-check',
      fields: [
        titleField(),
        { key: 'check_in', label: 'Check-in (ej. desde las 3:00 p. m.)', kind: 'text', max: 40 },
        { key: 'check_out', label: 'Check-out (ej. hasta las 12:00 m.)', kind: 'text', max: 40 },
        { key: 'cancellation', label: 'Cancelación', kind: 'text', max: 800, multiline: true },
        { key: 'house_rules', label: 'Reglas de la casa', kind: 'text', max: 800, multiline: true },
      ],
    },
    {
      type: 'gallery',
      label: 'Galería',
      description: 'Fotos del alojamiento y sus espacios.',
      icon: 'image',
      fields: galleryFields(),
    },
    {
      type: 'testimonials',
      label: 'Reseñas',
      description: 'Lo que dicen tus huéspedes.',
      icon: 'star',
      fields: testimonialsFields(),
    },
    {
      type: 'location',
      label: 'Ubicación',
      description: 'Dirección, cómo llegar y enlace al mapa.',
      icon: 'map-pin',
      fields: [
        titleField(),
        { key: 'address', label: 'Dirección', kind: 'text', max: 200 },
        { key: 'text', label: 'Cómo llegar', kind: 'text', max: 500, multiline: true },
        { key: 'map_url', label: 'Enlace al mapa (URL https)', kind: 'url' },
      ],
    },
    {
      type: 'faq',
      label: 'Preguntas frecuentes',
      description: 'Dudas antes de reservar.',
      icon: 'help-circle',
      fields: faqFields(),
    },
    {
      type: 'checkin_info',
      label: 'Check-in en línea',
      description: 'La nota del check-in en línea que ya muestra la página.',
      icon: 'id-card',
      existing: true,
      fields: [{ key: 'text', label: 'Texto', kind: 'text', max: 300, multiline: true }],
    },
    {
      type: 'products',
      label: 'Para tu estadía',
      description: 'Los productos que elegiste en "Reservas y dominio" (solo si la página vende).',
      icon: 'shopping-bag',
      existing: true,
      fields: [titleField()],
    },
  ],
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    // Books and still sells the products chosen in its settings, as today;
    // the owner can switch to "Solo reserva" in Operación.
    mode: 'both',
    booking: { source: 'rooms', require_account: false },
    hero: {
      title: 'Tu descanso empieza aquí',
      subtitle: 'Elige tus fechas y reserva directo con nosotros, al mejor precio.',
      button_label: 'Ver disponibilidad',
    },
    blocks: [
      { id: 'search', type: 'search', enabled: true, props: { title: '¿Cuándo nos visitas?' } },
      {
        id: 'amenities',
        type: 'amenities',
        enabled: true,
        props: { title: 'Lo que ofrecemos', items: ['Wifi', 'Parqueadero', 'Desayuno incluido', 'Recepción 24 horas'] },
      },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Políticas',
          check_in: 'Desde las 3:00 p. m.',
          check_out: 'Hasta las 12:00 m.',
          cancellation: 'Cancelación gratuita hasta 48 horas antes de la llegada.',
        },
      },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Conoce el lugar' } },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Reseñas de huéspedes',
          rating_summary: '4.8/5',
          items: [{ name: 'María', city: 'Bogotá', quote: 'Todo impecable y la atención excelente.', rating: 5 }],
        },
      },
      { id: 'location', type: 'location', enabled: false, props: { title: 'Ubicación' } },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [{ question: '¿Admiten mascotas?', answer: 'Escríbenos y te contamos las condiciones.' }],
        },
      },
      { id: 'checkin-info', type: 'checkin_info', enabled: true, props: {} },
      { id: 'products', type: 'products', enabled: true, props: { title: 'Para tu estadía' } },
    ],
  },
};
