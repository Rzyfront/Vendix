import {
  formatStoreTime,
  localCivil,
} from '../../../../../common/utils/store-timezone.util';

/**
 * Avisos de las tareas CRM (odd/tasks/recordatorios-notificaciones.md §2.1).
 * Textos cortos en lenguaje de negocio: en la pantalla bloqueada solo se ve el
 * título de la tarea y, como siempre, el nombre del cliente; nunca montos.
 */
export const CRM_TASK_ASSIGNED_NOTIFICATION = 'crm_task_assigned';
export const CRM_TASK_REASSIGNED_NOTIFICATION = 'crm_task_reassigned';
export const CRM_TASK_DUE_SOON_NOTIFICATION = 'crm_task_due_soon';
export const CRM_TASK_DUE_NOTIFICATION = 'crm_task_due';
export const CRM_TASK_CLOSED_NOTIFICATION = 'crm_task_closed';
export const CRM_TASK_DIGEST_NOTIFICATION = 'crm_task_digest';
export const CRM_TASKS_ROUTE = '/admin/customers/tasks';
/** `source_type` de las tareas en `scheduled_reminders`. */
export const CRM_TASK_REMINDER_SOURCE = 'crm_task';

/** Lo mínimo de una tarea para decidir a quién se avisa. */
export interface CrmTaskPeople {
  assigned_user_id: number | null;
  created_by_user_id: number | null;
  supporter_ids: number[];
}

/**
 * Destinatarios de los recordatorios de una tarea (plan §2):
 * - `notify` (por vencer, vencida): responsable + apoyos; sin responsable,
 *   el creador (+ apoyos).
 * - `escalate` (sigue vencida 24 h): el creador, solo si no es el responsable.
 */
export function crmTaskReminderRecipients(task: CrmTaskPeople): {
  notify: number[];
  escalate: number[];
} {
  const owner = task.assigned_user_id ?? task.created_by_user_id;
  const notify = [
    ...new Set([owner, ...task.supporter_ids].filter((id): id is number => !!id)),
  ];
  const escalate =
    task.created_by_user_id &&
    task.assigned_user_id &&
    task.created_by_user_id !== task.assigned_user_id
      ? [task.created_by_user_id]
      : [];
  return { notify, escalate };
}

export function crmTaskCustomerSuffix(
  customer: { first_name: string | null; last_name: string | null } | null | undefined,
): string {
  if (!customer) return '';
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
  return name ? ` · ${name}` : '';
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `dd/mm, 10:30 a. m.` en la zona de la tienda (`due_at` es un instante). */
export function formatCrmTaskDueAt(date: Date, tz: string): string {
  const civil = localCivil(date, tz);
  return `${pad(civil.day)}/${pad(civil.month)}, ${formatStoreTime(date, tz)}`;
}

export function crmTaskData(
  task_id: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { kind: 'crm_task', task_id, url: CRM_TASKS_ROUTE, ...extra };
}
