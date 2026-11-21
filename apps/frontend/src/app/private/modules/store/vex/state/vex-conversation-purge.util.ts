import type { VexPurgePreview } from '../services/vex-api.service';

/** «1 mensaje» / «42 mensajes». */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The parts of a deletion in Spanish with correct plurals, e.g.
 * «42 mensajes, 3 archivos y 1 recuerdo». Zero parts are omitted except the
 * messages, which always lead.
 */
export function describePurgeCounts(
  preview: Pick<VexPurgePreview, 'messages' | 'attachments' | 'blocks' | 'memories'>,
): string {
  const parts = [count(preview.messages, 'mensaje', 'mensajes')];
  if (preview.attachments > 0) {
    parts.push(count(preview.attachments, 'archivo', 'archivos'));
  }
  if (preview.blocks > 0) {
    parts.push(count(preview.blocks, 'tabla o gráfico', 'tablas o gráficos'));
  }
  if (preview.memories > 0) {
    parts.push(count(preview.memories, 'recuerdo', 'recuerdos'));
  }
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** Body of the confirmation dialog (the shared modal renders it as HTML: only `<br>` is used). */
export function purgeConfirmMessage(preview: VexPurgePreview): string {
  return [
    `Se borrarán ${describePurgeCounts(preview)}. No se puede deshacer.`,
    'Los recordatorios y notas de bitácora que guardaste desde esta conversación se conservan.',
    'Lo que Vex ya aplicó en tu negocio no se deshace.',
  ].join('<br><br>');
}

export const VEX_PURGE_RUNNING_MESSAGE =
  'Vex está ejecutando una tarea en esta conversación. Detenla antes de borrarla.';
