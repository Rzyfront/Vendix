import { createHash, randomBytes } from 'crypto';
import { WorkflowDefinitionV1, startStage } from '@common/workflows/contract';
import { hasBlockingRequirement } from '../engine/workflow-move-rules';

export type PublicFormUnavailableReason =
  | 'no_public_form_trigger'
  | 'start_stage_not_form'
  | 'blocking_requirement'
  | 'comment_required';

export const PUBLIC_FORM_UNAVAILABLE_MESSAGES: Record<PublicFormUnavailableReason, string> = {
  no_public_form_trigger: 'El flujo publicado no tiene el disparador de formulario público.',
  start_stage_not_form: 'La etapa inicial debe ser un formulario que complete quien inicia la solicitud.',
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
  // P3.4: file fields (required or not) are uploaded in chunks from the link.
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

const PUBLIC_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_HOME'] as const;

/**
 * `https://<hostname>` of the store's public site (ecommerce first, then
 * landing, then home), or null when the store has no active public domain.
 */
export async function publicStoreOrigin(
  db: {
    domain_settings: {
      findMany(args: unknown): Promise<Array<{ hostname: string; app_type: string }>>;
    };
  },
  storeId: number,
): Promise<string | null> {
  try {
    const domains = await db.domain_settings.findMany({
      where: { store_id: storeId, app_type: { in: [...PUBLIC_APP_TYPES] }, status: 'active' },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
      select: { hostname: true, app_type: true },
    });
    for (const type of PUBLIC_APP_TYPES) {
      const found = domains.find((d) => d.app_type === type && d.hostname);
      if (found) return `https://${found.hostname}`;
    }
    return null;
  } catch {
    return null;
  }
}
