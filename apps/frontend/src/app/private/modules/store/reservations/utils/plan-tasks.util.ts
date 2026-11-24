import type { PlanBookingTask } from '../../products/services/service-plans.service';

export type PlanTaskStatus = NonNullable<PlanBookingTask['status']>;

const STATUS_LABELS: Record<PlanTaskStatus, string> = {
  pending: 'Pendiente',
  done: 'Hecha',
  cancelled: 'Cancelada',
};

/** Etiqueta del estado de una tarea del plan; sin estado se considera pendiente. */
export function planTaskStatusLabel(status: PlanBookingTask['status']): string {
  return STATUS_LABELS[status ?? 'pending'] ?? STATUS_LABELS.pending;
}

/** Clase de color de la insignia: `paid` (hecha), `pending` o vacía (cancelada). */
export function planTaskStatusClass(status: PlanBookingTask['status']): string {
  if (status === 'done') return 'paid';
  if (status === 'cancelled') return '';
  return 'pending';
}

/** Responsable visible: nombre del usuario asignado o «Sin asignar». */
export function planTaskOwnerLabel(task: Pick<PlanBookingTask, 'assigned_user'>): string {
  const user = task.assigned_user;
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() : '';
  return name || 'Sin asignar';
}

/** Tipo de tarea: las de tercero piden confirmar con el proveedor. */
export function planTaskKindLabel(kind: PlanBookingTask['kind']): string {
  if (kind === 'supplier') return 'Proveedor';
  if (kind === 'internal') return 'Equipo propio';
  return '';
}

/** Enlace del panel de tareas del CRM que abre la tarea. */
export function planTaskCrmLink(taskId: number): { path: string; queryParams: { task: number } } {
  return { path: '/admin/customers/tasks', queryParams: { task: taskId } };
}

/** Ordena por fecha (las sin fecha al final) y, a igual fecha, por día del plan. */
export function sortPlanTasks(tasks: readonly PlanBookingTask[]): PlanBookingTask[] {
  const time = (t: PlanBookingTask) => (t.due_at ? Date.parse(t.due_at) : Number.POSITIVE_INFINITY);
  return [...tasks].sort(
    (a, b) => time(a) - time(b) || (a.day_number ?? 0) - (b.day_number ?? 0) || a.link_id - b.link_id,
  );
}
