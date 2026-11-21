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
} as const;
