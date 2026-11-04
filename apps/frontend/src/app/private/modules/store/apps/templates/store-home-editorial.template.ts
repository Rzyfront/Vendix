import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Store home · «Editorial»: a magazine-like entry page. Highlights tell the
 * story before the apps, serif titles, black and white with a red accent,
 * square corners and outline buttons. Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 17.6:1, secondary text 9.0:1, button 18.9:1, outline
 * button 18.9:1, accent 6.8:1 — all above 4.5:1.
 */
export const STORE_HOME_EDITORIAL: AppPageVariant = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Como una revista: tu historia y destacados primero, títulos con serifa y formas rectas.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#111111',
      secondary_color: '#3F3F46',
      surface_color: '#FFFFFF',
      text_color: '#111111',
      accent_color: '#A3341F',
      heading_font: 'playfair',
      body_font: 'lora',
      radius: 'none',
      density: 'spacious',
      button_style: 'outline',
      image_style: 'square',
      content_width: 'narrow',
    },
    hero: {
      eyebrow: 'Nuestra historia',
      title: 'Hacemos las cosas a nuestra manera',
      subtitle: 'Conoce lo que nos mueve y todo lo que tenemos para ti.',
    },
    blocks: [
      {
        id: 'highlights',
        type: 'highlights',
        enabled: true,
        props: {
          title: 'Lo que nos define',
          items: [
            { title: 'Origen', text: 'Cuenta cómo empezó tu negocio.' },
            { title: 'Oficio', text: 'Lo que haces mejor que nadie.' },
            { title: 'Compromiso', text: 'La promesa que cumples a tus clientes.' },
          ],
        },
      },
      { id: 'apps', type: 'apps', enabled: true, props: { title: 'Encuéntranos en línea' } },
      { id: 'contact', type: 'contact', enabled: true, props: { title: 'Visítanos' } },
    ],
  },
};
