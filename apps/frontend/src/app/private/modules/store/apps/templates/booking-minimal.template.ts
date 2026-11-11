import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Booking · «Minimalista»: a quiet, one-company booking page in the spirit
 * of the reference (search and rooms first, then the essentials). Black and
 * white palette, outline buttons, narrow layout and lots of air.
 * Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 14.9:1, secondary text 7.2:1, button 15.9:1, outline
 * button 15.9:1, accent 6.6:1 — all above 4.5:1.
 */
export const BOOKING_MINIMAL: AppPageVariant = {
  id: 'minimal',
  name: 'Minimalista',
  description: 'Limpia y silenciosa: fechas y habitaciones primero, blanco y negro, mucho aire.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#222222',
      secondary_color: '#4B5563',
      surface_color: '#FFFFFF',
      text_color: '#222222',
      accent_color: '#B42318',
      heading_font: 'inter',
      body_font: 'inter',
      radius: 'medium',
      density: 'spacious',
      button_style: 'outline',
      image_style: 'rounded',
      content_width: 'narrow',
    },
    hero: {
      title: 'Quédate con nosotros',
      subtitle: 'Reserva directo, sin intermediarios.',
    },
    blocks: [
      { id: 'search', type: 'search', enabled: true, props: { title: 'Elige tus fechas' } },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'El lugar' } },
      {
        id: 'amenities',
        type: 'amenities',
        enabled: false,
        props: { title: 'Incluye', items: [] },
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: false,
        props: { title: 'Reseñas', items: [] },
      },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Bueno saber',
          // Empty on purpose: the public page fills them from the store settings.
          check_in: '',
          check_out: '',
          cancellation: '',
        },
      },
      { id: 'location', type: 'location', enabled: false, props: { title: 'Ubicación' } },
      { id: 'checkin-info', type: 'checkin_info', enabled: true, props: {} },
      {
        id: 'faq',
        type: 'faq',
        enabled: false,
        props: { title: 'Preguntas frecuentes', items: [] },
      },
      { id: 'products', type: 'products', enabled: false, props: { title: 'Para tu estadía' } },
    ],
  },
};
