import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  CrmConsent,
  CrmCustomerSource,
  CrmOpenOpportunity,
  CrmPerson,
  CrmStage,
  CrmTask,
  CrmTaskMoveSkipReason,
  CrmTimelineType,
  personName,
} from './crm.interface';

/** Owner/admin (`store:crm_inbox:assign`) see and assign the whole store. */
export function crmCanSeeAll(auth: AuthFacade): boolean {
  return auth.isOwner() || auth.hasPermission('store:crm_inbox:assign');
}

export const CRM_SOURCE_LABELS: Record<CrmCustomerSource, string> = {
  pos: 'Punto de venta',
  ecommerce: 'Tienda en línea',
  whatsapp: 'WhatsApp',
  landing: 'Landing de captación',
  import: 'Importación',
  manual: 'Manual',
  referral: 'Referido',
};

export const CRM_CONSENT_LABELS: Record<CrmConsent, string> = {
  unknown: 'Sin definir',
  opted_in: 'Acepta',
  opted_out: 'No acepta',
};

export const CRM_TIMELINE_META: Record<
  CrmTimelineType,
  { label: string; icon: string }
> = {
  order: { label: 'Pedidos', icon: 'shopping-cart' },
  payment: { label: 'Pagos', icon: 'credit-card' },
  quotation: { label: 'Cotizaciones', icon: 'file-text' },
  booking: { label: 'Reservas', icon: 'calendar' },
  message: { label: 'Mensajes', icon: 'message-circle' },
  task: { label: 'Tareas', icon: 'check-square' },
  note: { label: 'Notas', icon: 'sticky-note' },
};

/** `datetime-local` value (browser local time) of an ISO instant. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO instant of a `datetime-local` value, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Date-only (`YYYY-MM-DD`) shown without a timezone shift. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-CO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Support people one task admits (same cap as the API). */
export const CRM_TASK_MAX_SUPPORTERS = 10;

/**
 * Stages a task can move its opportunity to: the active stages of its board
 * except the current one and the `lost` ones (losing asks for a reason, and
 * that stays on the board).
 */
export function taskTargetStages(opportunity: CrmOpenOpportunity | null): CrmStage[] {
  if (!opportunity) return [];
  return opportunity.stages.filter(
    (stage) => stage.kind !== 'lost' && stage.id !== opportunity.stage?.id,
  );
}

/** `Cotización X · Ventas · Propuesta`, as the task form lists it. */
export function openOpportunityLabel(opportunity: CrmOpenOpportunity): string {
  return [opportunity.title, opportunity.pipeline.name, opportunity.stage?.name]
    .filter(Boolean)
    .join(' · ');
}

/** The viewer helps with the task without being its assignee. */
export function isTaskSupporter(task: CrmTask, userId: number | null): boolean {
  if (userId == null || task.assigned_user?.id === userId) return false;
  return (task.support_users ?? []).some((person) => person.id === userId);
}

/** `Apoyo: Luis, Marta +1`: up to `max` support names, then how many more. */
export function supportLine(people: CrmPerson[] | null | undefined, max = 2): string {
  const list = people ?? [];
  if (!list.length) return '';
  const names = list.slice(0, max).map((person) => personName(person)).join(', ');
  const more = list.length - max;
  return `Apoyo: ${names}${more > 0 ? ` +${more}` : ''}`;
}

/** `Mueve «Oportunidad» → «Etapa»`, or empty when the task moves nothing. */
export function taskMoveLine(task: CrmTask): string {
  if (!task.opportunity || !task.move_to_stage) return '';
  return `Mueve «${task.opportunity.title}» → «${task.move_to_stage.name}»`;
}

const MOVE_SKIP_MESSAGES: Record<CrmTaskMoveSkipReason, string> = {
  opportunity_missing: 'la oportunidad ya no existe',
  opportunity_closed: 'la oportunidad ya está cerrada',
  already_in_stage: 'la oportunidad ya estaba en esa etapa',
  stage_unavailable: 'la etapa ya no está disponible',
  failed: 'no se pudo mover la oportunidad',
};

/**
 * Toast after completing a task. A task that moves its opportunity always
 * says `Tarea completada · …` with what happened; any other one says
 * `fallback` (the customer panel calls tasks "seguimientos").
 */
export function taskCompletedMessage(task: CrmTask, fallback = 'Tarea completada'): string {
  const move = task.opportunity_move;
  if (!move) return fallback;
  if (move.moved && move.stage) {
    return `Tarea completada · oportunidad movida a «${move.stage.name}»`;
  }
  return `Tarea completada · ${MOVE_SKIP_MESSAGES[move.reason ?? 'failed']}`;
}
