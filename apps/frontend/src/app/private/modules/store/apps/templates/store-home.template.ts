import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageTemplate,
  cardsFields,
  subtitleField,
  titleField,
} from './app-page.types';

/**
 * Store home base: the entry page of the store, with cards to its published
 * apps, highlights and contact. Only informs by default.
 *
 * Replace this file to change the store home base.
 */
export const STORE_HOME_TEMPLATE: AppPageTemplate = {
  kind: 'store_home',
  summary:
    'La portada de tu negocio: bienvenida, accesos a tus apps publicadas, destacados y contacto.',
  reference: 'Portada propia de Vendix',
  blocks: [
    {
      type: 'apps',
      label: 'Mis apps',
      description: 'Tarjetas automáticas a tus apps publicadas (tienda en línea, reservas, servicios…).',
      icon: 'layout-grid',
      existing: true,
      fields: [titleField(), subtitleField()],
    },
    {
      type: 'highlights',
      label: 'Destacados',
      description: 'Lo que hace especial a tu negocio.',
      icon: 'sparkles',
      fields: cardsFields('Destacado'),
    },
    {
      type: 'contact',
      label: 'Contacto',
      description: 'Teléfono, correo, dirección y horario.',
      icon: 'phone',
      fields: [
        titleField(),
        { key: 'phone', label: 'Teléfono', kind: 'text', max: 40 },
        { key: 'email', label: 'Correo', kind: 'text', max: 120 },
        { key: 'address', label: 'Dirección', kind: 'text', max: 200 },
        { key: 'hours', label: 'Horario', kind: 'text', max: 300, multiline: true },
      ],
    },
  ],
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    mode: 'info',
    hero: {
      title: 'Bienvenido',
      subtitle: 'Todo lo que ofrecemos, en un solo lugar.',
    },
    blocks: [
      { id: 'apps', type: 'apps', enabled: true, props: { title: 'Encuéntranos en línea' } },
      { id: 'highlights', type: 'highlights', enabled: false, props: { title: 'Por qué elegirnos', items: [] } },
      { id: 'contact', type: 'contact', enabled: true, props: { title: 'Contáctanos' } },
    ],
  },
};
