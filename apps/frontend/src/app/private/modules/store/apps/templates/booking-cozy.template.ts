import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Booking · «Cálido/acogedor»: a guesthouse / glamping page that welcomes.
 * Reviews and amenities right after the search, location and house rules,
 * earthy palette, serif titles and rounded corners.
 * Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 11.2:1, secondary text 5.7:1, button 6.7:1, accent
 * 6.2:1 — all above 4.5:1.
 */
export const BOOKING_COZY: AppPageVariant = {
  id: 'cozy',
  name: 'Cálido/acogedor',
  description: 'Acogedora: ubicación y normas de la casa cerca del buscador, con tonos tierra.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#8A4B2A',
      secondary_color: '#5E3B22',
      surface_color: '#FAF5EE',
      text_color: '#3B2F25',
      accent_color: '#6B5A1E',
      heading_font: 'lora',
      body_font: 'montserrat',
      radius: 'large',
      density: 'comfortable',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
    },
    hero: {
      eyebrow: 'Bienvenido a casa',
      title: 'Un lugar para bajar el ritmo',
      subtitle: 'Habitaciones cálidas y atención cercana.',
      button_label: 'Ver disponibilidad',
    },
    blocks: [
      { id: 'search', type: 'search', enabled: true, props: { title: '¿Cuándo llegas?' } },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: false,
        props: { title: 'Lo que cuentan nuestros huéspedes', items: [] },
      },
      {
        id: 'amenities',
        type: 'amenities',
        enabled: false,
        props: { title: 'Comodidades', items: [] },
      },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Rincones' } },
      { id: 'location', type: 'location', enabled: true, props: { title: 'Cómo llegar' } },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Normas de la casa',
          // Empty on purpose: the public page fills them from the store settings.
          check_in: '',
          check_out: '',
          cancellation: '',
          house_rules: '',
        },
      },
      { id: 'checkin-info', type: 'checkin_info', enabled: true, props: {} },
      { id: 'products', type: 'products', enabled: true, props: { title: 'Para tu estadía' } },
      {
        id: 'faq',
        type: 'faq',
        // No invented answers: the owner turns it on with their own questions.
        enabled: false,
        props: {
          title: 'Preguntas frecuentes',
          items: [],
        },
      },
    ],
  },
};
