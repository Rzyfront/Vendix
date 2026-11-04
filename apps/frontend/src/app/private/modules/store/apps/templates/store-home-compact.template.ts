import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Store home · «Compacta»: a quick launcher: contact first, then the apps
 * and three one-line highlights, everything close together on mobile.
 * Compact rhythm, wide layout, blue palette. Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 15.8:1, secondary text 7.9:1, button 6.7:1, accent
 * 6.4:1 — all above 4.5:1.
 */
export const STORE_HOME_COMPACT: AppPageVariant = {
  id: 'compact',
  name: 'Compacta',
  description: 'Directa: contacto y accesos a tus apps a la vista, poco espacio entre secciones.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#1D4ED8',
      secondary_color: '#1E3A8A',
      surface_color: '#F9FAFB',
      text_color: '#111827',
      accent_color: '#1D4ED8',
      heading_font: 'inter',
      body_font: 'inter',
      radius: 'small',
      density: 'compact',
      button_style: 'solid',
      image_style: 'square',
      content_width: 'wide',
    },
    hero: {
      title: 'Hola, ¿qué necesitas hoy?',
      subtitle: 'Compra, reserva o escríbenos.',
    },
    blocks: [
      { id: 'contact', type: 'contact', enabled: true, props: { title: 'Escríbenos o visítanos' } },
      { id: 'apps', type: 'apps', enabled: true, props: { title: 'Compra o reserva en línea' } },
      {
        id: 'highlights',
        type: 'highlights',
        enabled: true,
        props: {
          title: 'En pocas palabras',
          items: [
            { title: 'Rápido', text: 'Pide o reserva en un minuto.' },
            { title: 'Seguro', text: 'Pagos protegidos.' },
            { title: 'Cercano', text: 'Te respondemos el mismo día.' },
          ],
        },
      },
    ],
  },
};
