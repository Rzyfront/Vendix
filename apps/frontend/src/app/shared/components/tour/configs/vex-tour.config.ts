import { TourConfig } from '../services/tour.service';

/**
 * First-visit tour of the Vex page (`/admin/vex`).
 *
 * Deliberately NOT in `TOUR_CONFIG_MAP`: that map is what Vexi lists and
 * starts from the admin layout, and this tour's targets only exist on the
 * full-screen Vex page, which mounts outside that layout and owns its own
 * `app-tour-modal`.
 */
export const VEX_TOUR_CONFIG: TourConfig = {
  id: 'vex-first-visit',
  name: 'Recorrido de Vex',
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: 'welcome',
      title: 'Conoce a Vex',
      description:
        'Vex es tu asistente del negocio: le preguntas y te responde con los datos de tu tienda.',
    },
    {
      id: 'suggestions',
      title: 'Empieza con una sugerencia',
      description:
        'Estas preguntas cambian según lo que tu tienda tiene pendiente hoy.',
      target: '[data-tour="vex-suggestions"]',
      position: 'bottom',
    },
    {
      id: 'composer',
      title: 'Escribe, habla o adjunta',
      description:
        'Pídele lo que necesites. Antes de cambiar algo, Vex te muestra el plan y espera tu confirmación.',
      target: '[data-tour="vex-composer"]',
      position: 'top',
    },
    {
      id: 'chats',
      title: 'Tus conversaciones',
      description:
        'Aquí quedan guardadas. Puedes renombrarlas o borrarlas de verdad cuando quieras.',
      targetDesktop: '[data-tour="vex-chats"]',
      targetMobile: '[data-tour="vex-chats-button"]',
    },
    {
      id: 'log',
      title: 'Tu bitácora',
      description:
        'Los recordatorios y notas que guardes con Vex aparecen aquí, junto a la actividad de la tienda.',
      targetDesktop: '[data-tour="vex-log"]',
      targetMobile: '[data-tour="vex-log-button"]',
    },
    {
      id: 'help',
      title: '¿Dudas?',
      description: 'En «¿Cómo funciona Vex?» tienes el detalle cuando lo necesites.',
      target: '[data-tour="vex-help"]',
    },
  ],
};
