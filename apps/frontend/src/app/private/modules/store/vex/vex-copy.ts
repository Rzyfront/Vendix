/**
 * Every user-facing string of the Vex view lives here: one voice (tú, neutral,
 * short) and one set of verbs («Abrir/Cerrar», «Guardar», «Borrar»,
 * «Renombrar», «Reintentar», «Detener»). Components read from `VEX_COPY`; they
 * never inline Spanish text.
 */
export const VEX_COPY = {
  presence: {
    group_label: 'Estado de Vex',
    listening_text: 'Escuchando',
    listening_voice: 'Escuchando tu voz',
    thinking: 'Pensando',
    speaking_writing: 'Respondiendo',
    speaking_voice: 'Hablando',
    silent: 'En silencio',
    stop_reading: 'Detener',
    stop_reading_aria: 'Detener la lectura en voz alta',
    reading_aloud: 'Vex está leyendo este mensaje',
    still_writing: 'Vex sigue escribiendo',
  },
  followup: {
    region_label: 'Seguimiento sugerido por Vex',
    heading_reminder: '¿Te lo recuerdo?',
    heading_log: '¿Lo anoto en tu bitácora?',
    no_date: 'Sin fecha',
    save: 'Guardar',
    edit: 'Editar',
    dismiss: 'No',
    dismiss_aria: 'No guardar este seguimiento',
    mute: 'No sugerir en este chat',
    cancel_edit: 'Cancelar',
    field_title: 'Qué recordar',
    field_when: 'Fecha y hora',
    field_when_hint: 'Opcional. Hora de la tienda.',
    title_required: 'Escribe qué quieres recordar.',
    saved_reminder: 'Recordatorio guardado en tu bitácora',
    saved_log: 'Anotado en tu bitácora',
    muted_notice: 'Vex no sugerirá seguimientos en este chat.',
    unmute: 'Volver a sugerir',
  },
  welcome: {
    greeting: '¿Con qué seguimos?',
    greeting_named: (first_name: string) => `¿Con qué seguimos, ${first_name}?`,
    suggestions_label: 'Sugerencias para empezar',
    how_it_works: '¿Cómo funciona Vex?',
    suggestions: {
      reminders_today: {
        label: '¿Qué tengo pendiente hoy?',
        prompt: '¿Qué recordatorios tengo pendientes para hoy?',
      },
      cash_close: {
        label: 'Cuadre de caja',
        prompt: 'Ayúdame con el cuadre de la caja que está abierta.',
      },
      restock: {
        label: '¿Qué debo reabastecer?',
        prompt: '¿Qué productos debo reabastecer?',
      },
      sales_today: {
        label: 'Resumen de ventas de hoy',
        prompt: 'Dame el resumen de ventas de hoy.',
      },
      top_products: {
        label: 'Productos más vendidos',
        prompt: '¿Cuáles son mis productos más vendidos este mes?',
      },
      overdue_receivables: {
        label: 'Clientes con cartera vencida',
        prompt: '¿Qué clientes tienen cartera vencida?',
      },
    },
  },
  help: {
    open: '¿Cómo funciona Vex?',
    open_aria: 'Abrir la ayuda de Vex',
    title: '¿Cómo funciona Vex?',
    subtitle: 'Lo esencial para trabajar tranquilo con tu asistente.',
    close: 'Cerrar',
    replay_tour: 'Ver el recorrido',
    sections: [
      {
        icon: 'shield-check',
        title: 'Nada cambia sin tu confirmación',
        body: 'Vex consulta tus datos libremente, pero antes de crear, cambiar o borrar algo te muestra el plan paso a paso. Solo lo aplica cuando lo confirmas, y puedes cancelarlo.',
      },
      {
        icon: 'bell',
        title: 'Recordatorios y bitácora',
        body: 'Si dices «recuérdame…», Vex lo guarda de una vez. Si detecta un pendiente en la conversación, te lo sugiere con una ficha: tú decides con Guardar, Editar o No. Todo queda en tu bitácora, y puedes apagar las sugerencias en cada chat.',
      },
      {
        icon: 'brain',
        title: 'Qué recuerda',
        body: 'Vex recuerda lo que hablan dentro de cada conversación, y tus conversaciones quedan guardadas para retomarlas. Puedes renombrarlas para encontrarlas rápido.',
      },
      {
        icon: 'trash-2',
        title: 'Borrar de verdad',
        body: 'Al borrar una conversación se eliminan sus mensajes, sus adjuntos y lo que Vex aprendió de ella. Se conservan los recordatorios y notas que guardaste en tu bitácora, y el registro de uso sin contenido para la facturación. Las copias de seguridad se renuevan solas con el tiempo.',
      },
    ],
  },
  page: {
    back: 'Panel',
    back_aria: 'Volver al panel',
    open_chats: 'Abrir chats',
    open_log: 'Abrir bitácora',
    drop_to_attach: 'Suelta para adjuntar',
    rename: 'Renombrar',
    rename_aria: (title: string) => `Renombrar la conversación: ${title}`,
  },
  thread: {
    loading: 'Abriendo conversación…',
    writing: 'Vex está escribiendo',
    retry: 'Reintentar',
    stop: 'Detener',
    stop_aria: 'Detener respuesta',
    copy_code: 'Copiar',
    copied_code: 'Copiado',
    copy_code_aria: 'Copiar el código',
  },
} as const;
