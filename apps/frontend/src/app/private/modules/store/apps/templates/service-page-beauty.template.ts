import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Service page · «Belleza cálida»: a salon / spa page that sells with
 * closeness. Testimonials and the team come right after the services, warm
 * rose palette, serif titles, very rounded corners and spacious rhythm.
 * Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 12.9:1, secondary text 6.5:1, button 5.4:1, accent
 * 6.1:1 — all above 4.5:1.
 */
export const SERVICE_PAGE_BEAUTY: AppPageVariant = {
  id: 'beauty',
  name: 'Belleza cálida',
  description: 'Cercana y cálida: servicios, testimonios y equipo primero, tonos rosados y esquinas suaves.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#B0436A',
      secondary_color: '#7E2E4C',
      surface_color: '#FFF7F5',
      text_color: '#3A2329',
      accent_color: '#9C3D5C',
      heading_font: 'playfair',
      body_font: 'poppins',
      radius: 'large',
      density: 'spacious',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
    },
    hero: {
      eyebrow: 'Tu momento',
      title: 'Consiéntete, nosotras nos encargamos',
      subtitle: 'Reserva en segundos, sin crear cuenta. Te recordamos tu cita un día antes.',
      button_label: 'Reservar mi cita',
    },
    blocks: [
      { id: 'services', type: 'services', enabled: true, props: { title: 'Elige tu servicio', show_duration: true, show_price: true } },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Lo que dicen nuestras clientas',
          rating_summary: '4.9/5',
          items: [
            { name: 'Daniela', city: 'Bogotá', quote: 'Me atendieron puntual y salí feliz con mi cambio.', rating: 5 },
            { name: 'Sofía', city: 'Barranquilla', quote: 'Reservar fue facilísimo, sin llamadas.', rating: 5 },
          ],
        },
      },
      { id: 'team', type: 'team', enabled: false, props: { title: 'Nuestro equipo', items: [] } },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Nuestro trabajo' } },
      {
        id: 'how-it-works',
        type: 'how_it_works',
        enabled: true,
        props: {
          title: 'Así de fácil',
          items: [
            { title: 'Elige', text: 'Tu servicio, con precio y duración a la vista.' },
            { title: 'Agenda', text: 'Solo ves los horarios realmente libres.' },
            { title: 'Llega', text: 'Te esperamos; te recordamos la cita un día antes.' },
          ],
        },
      },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Antes de tu cita',
          cancellation: 'Puedes cancelar o mover tu cita hasta 12 horas antes.',
          reminders: 'Te enviamos un recordatorio el día anterior.',
        },
      },
      { id: 'products', type: 'products', enabled: true, props: { title: 'Lleva tu rutina a casa' } },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [{ question: '¿Necesito crear una cuenta?', answer: 'No. Solo tu nombre y tu teléfono.' }],
        },
      },
      { id: 'cta', type: 'cta', enabled: true, props: { title: 'Te estamos esperando', button_label: 'Reservar ahora' } },
    ],
  },
};
