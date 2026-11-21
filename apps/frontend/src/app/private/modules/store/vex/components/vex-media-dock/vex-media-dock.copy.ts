/** User-facing copy (es-CO) for the Vex media dock and the learning blocks. */
export const VEX_MEDIA_COPY = {
  dock: {
    region: 'Reproductor de Vex',
    now_playing: 'Reproduciendo',
    minimize: 'Minimizar',
    expand: 'Restaurar reproductor',
    fullscreen: 'Pantalla completa',
    exit_fullscreen: 'Salir de pantalla completa',
    close: 'Cerrar reproductor',
    next: 'Siguiente video',
    previous: 'Video anterior',
    mark_done: 'Marcar como visto',
    done: 'Visto',
    queue: 'Ruta de aprendizaje',
    queue_item: (position: number, title: string, completed: boolean) =>
      `${position}. ${title}${completed ? ' (visto)' : ''}`,
    position: (current: number, total: number) => `Video ${current} de ${total}`,
    approx_note:
      'Este reproductor no informa el avance: usa «Marcar como visto» al terminar.',
  },
  blocks: {
    play: 'Reproducir',
    play_aria: (title: string) => `Reproducir video: ${title}`,
    continue: 'Continuar ruta',
    start: 'Empezar ruta',
    review: 'Repasar ruta',
    progress: (done: number, total: number) =>
      `${done} de ${total} videos vistos`,
    seconds_in: (time: string) => `Vas en ${time}`,
    completed: 'Visto',
    show_more: 'Ver más',
    show_less: 'Cerrar',
    article_label: 'Artículo del centro de ayuda',
    video_label: 'Video del centro de ayuda',
    path_label: 'Ruta de aprendizaje',
    related_video: 'Ver video relacionado',
    unavailable: 'Este contenido no está disponible.',
    types: {
      GUIDE: 'Guía',
      TUTORIAL: 'Tutorial',
      FAQ: 'Pregunta frecuente',
      ANNOUNCEMENT: 'Novedad',
    } as Record<string, string>,
  },
} as const;

/** `125` -> `2:05`; `3725` -> `1:02:05`. Non-finite or negative values give `0:00`. */
export function formatMediaTime(totalSeconds: number | null | undefined): string {
  const safe =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds)
      ? Math.max(0, Math.floor(totalSeconds))
      : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
    : `${minutes}:${ss}`;
}
