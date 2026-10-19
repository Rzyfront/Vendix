import type { ToolPreview } from '../../../ai-engine/tools/interfaces/tool.interface';
import { ConflictException } from '@nestjs/common';

/** Operation and human subject; full diff/consequence is read separately. */
export function describeVoiceAction(preview: ToolPreview): string {
  if (
    !preview ||
    typeof preview.target !== 'string' ||
    !preview.target.trim() ||
    !Array.isArray(preview.changes) ||
    preview.changes.some(
      (change) =>
        !change || typeof change.label !== 'string' || !change.label.trim(),
    )
  )
    throw new ConflictException(
      'No hay un sujeto y valores legibles para confirmar por voz. Revisa el cambio con clic.',
    );
  const field =
    preview.changes.length === 1 ? ` ${preview.changes[0].label}` : '';
  return `cambiar ${preview.target}${field}`.trim();
}
