import { createHash, randomBytes } from 'crypto';
import { WorkflowDefinitionV1, startStage } from '@common/workflows/contract';
import { hasBlockingRequirement } from '../engine/workflow-move-rules';

export type PublicFormUnavailableReason =
  | 'no_public_form_trigger'
  | 'start_stage_not_form'
  | 'required_file_field'
  | 'blocking_requirement'
  | 'comment_required';

export const PUBLIC_FORM_UNAVAILABLE_MESSAGES: Record<PublicFormUnavailableReason, string> = {
  no_public_form_trigger: 'El flujo publicado no tiene el disparador de formulario público.',
  start_stage_not_form: 'La etapa inicial debe ser un formulario que complete quien inicia la solicitud.',
  required_file_field:
    'El formulario inicial tiene campos de archivo obligatorios y la carga de archivos por enlace público aún no está disponible.',
  blocking_requirement: 'La etapa inicial tiene requisitos de documentos que no se pueden cumplir por enlace público.',
  comment_required: 'El envío del formulario inicial exige un comentario y el enlace público no lo permite.',
};

/** Whether the published definition can be offered as a public form. */
export function publicFormAvailability(
  definition: WorkflowDefinitionV1,
): { available: true } | { available: false; reason: PublicFormUnavailableReason } {
  const fail = (reason: PublicFormUnavailableReason) => ({ available: false as const, reason });
  if (!(definition.triggers ?? []).some((t) => t.kind === 'public_form')) {
    return fail('no_public_form_trigger');
  }
  const stage = startStage(definition);
  if (!stage || stage.type !== 'form' || stage.assignee?.kind !== 'initiator') {
    return fail('start_stage_not_form');
  }
  const requiredFile = (stage.form?.fields ?? []).some((k) => {
    const f = definition.fields.find((x) => x.key === k);
    return f?.type === 'file' && f.required;
  });
  if (requiredFile) return fail('required_file_field');
  if (hasBlockingRequirement(stage)) return fail('blocking_requirement');
  const submits = (stage.transitions ?? []).filter((t) => t.on === 'submit');
  if (submits.length > 0 && submits.every((t) => t.require_comment)) return fail('comment_required');
  return { available: true };
}

export function newPublicToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashPublicToken(token) };
}

export function hashPublicToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function submissionKey(token: string, submissionId: string): string {
  return createHash('sha256').update(`${token}:${submissionId}`).digest('hex');
}
