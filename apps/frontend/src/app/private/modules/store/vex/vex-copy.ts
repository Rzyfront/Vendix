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
} as const;
