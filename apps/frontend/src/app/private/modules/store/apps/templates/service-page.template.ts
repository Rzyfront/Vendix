import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageTemplate,
  ctaFields,
  faqFields,
  galleryFields,
  stepsFields,
  subtitleField,
  testimonialsFields,
  titleField,
} from './app-page.types';

/**
 * Service page base (reference: agenda-beauty.com — how it presents services
 * and booking). Hero with the star service, the service list with price,
 * duration and photo (the store's real services and agenda), booking without
 * an account, team, policies, testimonials and FAQ.
 *
 * Replace this file to change the service page base.
 */
export const SERVICE_PAGE_TEMPLATE: AppPageTemplate = {
  kind: 'service_page',
  summary:
    'Una página de servicios: portada con tu servicio estrella, la lista de servicios con precio y duración, reserva sin crear cuenta, tu equipo, políticas, testimonios y preguntas frecuentes.',
  reference: 'agenda-beauty.com',
  blocks: [
    {
      type: 'services',
      label: 'Servicios',
      description: 'Tus servicios reales con precio, duración y reserva (los de "Servicios y dominio").',
      icon: 'briefcase',
      existing: true,
      fields: [
        titleField(),
        subtitleField(),
        { key: 'show_duration', label: 'Mostrar duración', kind: 'bool' },
        { key: 'show_price', label: 'Mostrar precio', kind: 'bool' },
      ],
    },
    {
      type: 'how_it_works',
      label: 'Cómo reservar',
      description: 'Los pasos para agendar, en 1-2-3.',
      icon: 'list-ordered',
      fields: stepsFields(),
    },
    {
      type: 'team',
      label: 'Equipo',
      description: 'Profesionales que atienden, con foto y especialidad.',
      icon: 'users',
      fields: [
        titleField(),
        {
          key: 'items',
          label: 'Profesionales',
          kind: 'list',
          max: 12,
          itemLabel: 'Profesional',
          item: [
            { key: 'name', label: 'Nombre', kind: 'text', max: 80 },
            { key: 'role', label: 'Especialidad', kind: 'text', max: 80 },
            { key: 'bio', label: 'Descripción', kind: 'text', max: 400, multiline: true },
            { key: 'photo_url', label: 'Foto (URL https)', kind: 'url' },
          ],
        },
      ],
    },
    {
      type: 'policies',
      label: 'Políticas',
      description: 'Anticipo, cancelación y recordatorios.',
      icon: 'shield-check',
      fields: [
        titleField(),
        { key: 'deposit', label: 'Anticipo', kind: 'text', max: 500, multiline: true },
        { key: 'cancellation', label: 'Cancelación', kind: 'text', max: 800, multiline: true },
        { key: 'reminders', label: 'Recordatorios', kind: 'text', max: 500, multiline: true },
      ],
    },
    {
      type: 'gallery',
      label: 'Galería',
      description: 'Fotos de tu trabajo y de tu local.',
      icon: 'image',
      fields: galleryFields(),
    },
    {
      type: 'testimonials',
      label: 'Testimonios',
      description: 'Lo que dicen tus clientas y clientes.',
      icon: 'star',
      fields: testimonialsFields(),
    },
    {
      type: 'faq',
      label: 'Preguntas frecuentes',
      description: 'Dudas antes de reservar.',
      icon: 'help-circle',
      fields: faqFields(),
    },
    {
      type: 'products',
      label: 'También puedes comprar',
      description: 'Los productos que elegiste en "Servicios y dominio" (solo si la página vende).',
      icon: 'shopping-bag',
      existing: true,
      fields: [titleField()],
    },
    {
      type: 'cta',
      label: 'Llamado final',
      description: 'Cierre con un botón para reservar.',
      icon: 'mouse-pointer-click',
      fields: ctaFields(),
    },
  ],
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    // Books and still sells the products chosen in its settings, as today;
    // the owner can switch to "Solo reserva" in Operación.
    mode: 'both',
    booking: { source: 'agenda', require_account: false },
    hero: {
      eyebrow: 'Agenda en línea',
      title: 'Reserva tu cita en segundos',
      subtitle: 'Elige el servicio, el día y la hora. Sin crear cuenta: solo tu nombre y tu teléfono.',
      button_label: 'Reservar ahora',
    },
    blocks: [
      {
        id: 'services',
        type: 'services',
        enabled: true,
        props: { title: 'Nuestros servicios', show_duration: true, show_price: true },
      },
      {
        id: 'how-it-works',
        type: 'how_it_works',
        enabled: true,
        props: {
          title: 'Cómo reservar',
          items: [
            { title: 'Elige tu servicio', text: 'Mira precio y duración antes de decidir.' },
            { title: 'Escoge día y hora', text: 'Solo ves los horarios realmente libres.' },
            { title: 'Confirma', text: 'Te llega la confirmación y un recordatorio.' },
          ],
        },
      },
      { id: 'team', type: 'team', enabled: false, props: { title: 'Nuestro equipo', items: [] } },
      {
        id: 'policies',
        type: 'policies',
        enabled: true,
        props: {
          title: 'Políticas',
          cancellation: 'Puedes cancelar o reprogramar hasta 24 horas antes de tu cita.',
          reminders: 'Te recordamos tu cita un día antes.',
        },
      },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Nuestro trabajo' } },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Lo que dicen de nosotros',
          rating_summary: '4.9/5',
          items: [
            { name: 'Camila', city: 'Cali', quote: 'Reservé en un minuto y me atendieron puntual.', rating: 5 },
          ],
        },
      },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [
            { question: '¿Necesito crear una cuenta?', answer: 'No. Solo tu nombre y tu teléfono.' },
            { question: '¿Puedo cambiar mi cita?', answer: 'Sí, hasta 24 horas antes.' },
          ],
        },
      },
      { id: 'products', type: 'products', enabled: true, props: { title: 'También puedes comprar' } },
      {
        id: 'cta',
        type: 'cta',
        enabled: true,
        props: { title: 'Tu próxima cita está a un clic', button_label: 'Reservar ahora' },
      },
    ],
  },
};
