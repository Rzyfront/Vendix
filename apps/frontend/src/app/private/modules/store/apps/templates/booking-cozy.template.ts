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
  description: 'Acogedora: reseñas y comodidades cerca del buscador, ubicación y tonos tierra.',
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
      subtitle: 'Habitaciones cálidas, desayuno casero y atención de familia.',
      button_label: 'Ver disponibilidad',
    },
    blocks: [
      { id: 'search', type: 'search', enabled: true, props: { title: '¿Cuándo llegas?' } },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Lo que cuentan nuestros huéspedes',
          rating_summary: '4.9/5',
          items: [
            { name: 'Mariana', city: 'Medellín', quote: 'Nos sentimos en casa desde que llegamos.', rating: 5 },
            { name: 'Felipe', city: 'Bogotá', quote: 'El desayuno y la atención, de diez.', rating: 5 },
          ],
        },
      },
      {
        id: 'amenities',
        type: 'amenities',
        enabled: true,
        props: { title: 'Comodidades', items: ['Desayuno casero', 'Wifi', 'Zona verde', 'Parqueadero', 'Admite mascotas'] },
      },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Rincones' } },
      { id: 'location', type: 'location', enabled: true, props: { title: 'Cómo llegar' } },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Normas de la casa',
          check_in: 'Desde las 2:00 p. m.',
          check_out: 'Hasta las 11:00 a. m.',
          cancellation: 'Cancelación gratuita hasta 72 horas antes.',
          house_rules: 'Silencio después de las 10:00 p. m.',
        },
      },
      { id: 'checkin-info', type: 'checkin_info', enabled: true, props: {} },
      { id: 'products', type: 'products', enabled: true, props: { title: 'Para tu estadía' } },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [{ question: '¿Incluye desayuno?', answer: 'Sí, todas las tarifas incluyen desayuno.' }],
        },
      },
    ],
  },
};
