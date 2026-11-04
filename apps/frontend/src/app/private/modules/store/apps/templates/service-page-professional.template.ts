import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Service page · «Profesional sobrio»: a consultancy / clinic / workshop page
 * that sells with clarity. Process, policies and FAQ come before testimonials,
 * navy palette, sans-serif, small corners, compact rhythm and a wide layout.
 * Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 13.1:1, secondary text 6.6:1, button 11.5:1, accent
 * 6.4:1 — all above 4.5:1.
 */
export const SERVICE_PAGE_PROFESSIONAL: AppPageVariant = {
  id: 'professional',
  name: 'Profesional sobrio',
  description: 'Seria y ordenada: proceso, políticas y preguntas antes que testimonios, azul marino y formas rectas.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#1E3A5F',
      secondary_color: '#334E68',
      surface_color: '#F8FAFC',
      text_color: '#1E293B',
      accent_color: '#1D4ED8',
      heading_font: 'montserrat',
      body_font: 'inter',
      radius: 'small',
      density: 'compact',
      button_style: 'solid',
      image_style: 'square',
      content_width: 'wide',
    },
    hero: {
      eyebrow: 'Atención profesional',
      title: 'Agenda con especialistas, sin esperas',
      subtitle: 'Horarios reales, confirmación inmediata y recordatorio automático.',
      button_label: 'Agendar',
    },
    blocks: [
      { id: 'services', type: 'services', enabled: true, props: { title: 'Servicios', show_duration: true, show_price: true } },
      {
        id: 'how-it-works',
        type: 'how_it_works',
        enabled: true,
        props: {
          title: 'Proceso',
          items: [
            { title: '1. Selecciona', text: 'El servicio y el profesional.' },
            { title: '2. Agenda', text: 'Fecha y hora disponibles.' },
            { title: '3. Confirma', text: 'Recibe la confirmación y el recordatorio.' },
          ],
        },
      },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Políticas',
          deposit: 'Algunos servicios requieren anticipo para confirmar.',
          cancellation: 'Cancelaciones con 24 horas de anticipación.',
          reminders: 'Recordatorio automático el día anterior.',
        },
      },
      { id: 'team', type: 'team', enabled: false, props: { title: 'Profesionales', items: [] } },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [{ question: '¿Puedo reprogramar?', answer: 'Sí, hasta 24 horas antes de tu cita.' }],
        },
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Clientes',
          rating_summary: '4.8/5',
          items: [{ name: 'Jorge', city: 'Bogotá', quote: 'Puntuales y muy claros con el proceso.', rating: 5 }],
        },
      },
      { id: 'products', type: 'products', enabled: true, props: { title: 'Productos' } },
      { id: 'cta', type: 'cta', enabled: true, props: { title: 'Agenda tu cita hoy', button_label: 'Agendar' } },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Instalaciones' } },
    ],
  },
};
