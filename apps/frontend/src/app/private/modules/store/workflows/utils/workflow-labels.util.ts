import {
  WorkflowDefinitionRow,
  WorkflowInstanceStatus,
} from '../interfaces/workflow.interfaces';

export type BadgeTone = 'success' | 'neutral' | 'error' | 'primary' | 'warning' | 'info';

export const DEFINITION_STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  active: 'Publicado',
  archived: 'Archivado',
};

/** "Borrador" / "Publicado v3" / "Archivado". */
export function definitionStatusLabel(row: WorkflowDefinitionRow): string {
  if (row.status === 'active' && row.published_version) {
    return `Publicado v${row.published_version.version}`;
  }
  return DEFINITION_STATUS_LABEL[row.status] ?? row.status;
}

export function definitionStatusTone(status: string): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'archived') return 'neutral';
  return 'warning';
}

export const INSTANCE_STATUS_LABEL: Record<WorkflowInstanceStatus, string> = {
  active: 'En curso',
  completed: 'Completada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  failed: 'Con error',
};

export function instanceStatusLabel(status: string): string {
  return INSTANCE_STATUS_LABEL[status as WorkflowInstanceStatus] ?? status;
}

export function instanceStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
      return 'info';
    case 'completed':
      return 'success';
    case 'rejected':
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

export const EVENT_LABEL: Record<string, string> = {
  started: 'Solicitud iniciada',
  transitioned: 'Avanzó de etapa',
  task_completed: 'Etapa completada',
  vote: 'Voto registrado',
  claimed: 'Tarea tomada',
  forced: 'Movida por administración',
  cancelled: 'Cancelada',
  escalated: 'Escalada',
  unassigned: 'Sin responsable',
  failed: 'Error',
  branch_completed: 'Rama completada',
  joined: 'Ramas unidas',
  subflow_started: 'Subflujo iniciado',
  subflow_closed: 'Subflujo cerrado',
  subflow_failed: 'Subflujo con error',
  waiting: 'En espera',
  loop_iteration: 'Vuelta del bucle',
  loop_done: 'Bucle terminado',
  guard_redirected: 'Redirigida por guarda',
  guard_blocked: 'Bloqueada por guarda',
  action_executed: 'Acción ejecutada',
  action_failed: 'Acción fallida',
  action_retried: 'Acción reenviada',
  error_routed: 'Enviada a la ruta de error',
  migrated: 'Solicitud migrada',
  ai_step_completed: 'Paso de IA completado',
  ai_step_failed: 'Paso de IA fallido',
  external_upload: 'Documento enviado por el solicitante',
  external_message: 'Respuesta del solicitante',
  email_received: 'Correo recibido',
  signature_requested: 'Documento enviado a firmar',
  signature_completed: 'Documento firmado',
  signature_declined: 'Firma rechazada',
  signature_cancelled: 'Firma cancelada',
  signature_expired: 'Solicitud de firma vencida',
};

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

const CHILD_OUTCOME_LABEL: Record<string, string> = {
  completed: 'completada',
  rejected: 'rechazada',
  cancelled: 'cancelada',
  failed: 'con error',
};

const AI_TASK_LABEL: Record<string, string> = {
  classify: 'clasificó',
  extract: 'extrajo datos',
  summarize: 'resumió',
  draft: 'redactó',
  decide: 'decidió la rama',
};

/** "82 %" from a 0..1 confidence; empty when it is not a number. */
function confidencePercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Math.round(Math.min(1, Math.max(0, value)) * 100)} %`
    : '';
}

/**
 * Timeline line of an event: the label plus the details of its payload
 * ("Subflujo iniciado: FLU-12", "Vuelta 1 de 3", "Rama completada: TI (2 de 3)").
 */
export function eventDescription(
  type: string,
  payload: Record<string, unknown> | null,
): string {
  const label = eventLabel(type);
  const p = payload ?? {};
  switch (type) {
    case 'branch_completed':
      return `${label}: ${text(p['branch_name'] ?? p['branch_key'])} (${text(p['done'])} de ${text(p['total'])})`;
    case 'subflow_started':
      return `${label}: ${text(p['child_reference'])}${p['flow_key'] ? ' · ' + text(p['flow_key']) : ''}`;
    case 'subflow_closed':
      return `${label}: ${text(p['child_reference'])} ${CHILD_OUTCOME_LABEL[text(p['outcome'])] ?? text(p['outcome'])}`;
    case 'subflow_failed':
      return `${label}: ${text(p['flow_key'])}${p['error'] ? ' — ' + text(p['error']) : ''}`;
    case 'loop_iteration':
      return `Vuelta ${text(p['iteration'])} de ${text(p['max'])}`;
    case 'loop_done':
      return p['limit_reached'] === true
        ? `${label} al llegar al límite (${text(p['iterations'])} vueltas)`
        : `${label} (${text(p['iterations'])} vueltas)`;
    case 'guard_redirected':
    case 'guard_blocked':
      return p['message'] ? `${label}: ${text(p['message'])}` : label;
    case 'action_failed':
      return `${label}: ${text(p['action'])}${p['error'] ? ' — ' + text(p['error']) : ''}`;
    case 'action_executed':
    case 'action_retried':
      return `${label}: ${text(p['action'])}`;
    case 'error_routed':
      return `${label}: ${text(p['action'])}`;
    case 'signature_declined':
    case 'signature_cancelled':
      return p['label'] ? text(p['label']) : label;
    case 'ai_step_completed': {
      const task = AI_TASK_LABEL[text(p['task'])];
      const confidence = confidencePercent(p['confidence']);
      return `${label}${task ? ': ' + task : ''}${confidence ? ` (confianza ${confidence})` : ''}`;
    }
    case 'ai_step_failed':
      return p['reason'] ? `${label}: ${text(p['reason'])}` : label;
    case 'migrated':
      return `Migrada de v${text(p['from_version'])} a v${text(p['to_version'])}`;
    case 'started':
      if (p['via'] === 'schedule') return `${label} por Programación`;
      return p['parent_reference'] ? `${label} desde ${text(p['parent_reference'])}` : label;
    default:
      return label;
  }
}

/** "2 d 23 h", "5 h 10 min", "40 s": remaining time of a wait; "Ya venció" when over. */
export function countdownText(untilIso: string, now: number = Date.now()): string {
  const until = new Date(untilIso).getTime();
  if (Number.isNaN(until)) return '—';
  const total = Math.floor((until - now) / 1000);
  if (total <= 0) return 'Ya venció';
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type;
}

export const OUTCOME_LABEL: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
  joined: 'Unir ramas',
  completed: 'Completada',
  rejected: 'Rechazada',
  elapsed: 'Espera cumplida',
  continue: 'Otra vuelta',
  done: 'Terminado',
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

/** Outcomes that move the request forward and are blocked by pending requirements. */
export function outcomeBlockedByRequirements(outcome: string): boolean {
  return outcome === 'approve' || outcome === 'submit';
}

/**
 * Relative due text that never relies on color alone:
 * "Vence en 3 h", "Vencida hace 2 días", "Sin plazo".
 */
export function dueText(dueAt: string | null, now: number = Date.now()): string {
  if (!dueAt) return 'Sin plazo';
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return 'Sin plazo';
  const diff = due - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let span: string;
  if (minutes < 60) span = `${Math.max(minutes, 1)} min`;
  else if (hours < 48) span = `${hours} h`;
  else span = `${days} días`;
  return diff < 0 ? `Vencida hace ${span}` : `Vence en ${span}`;
}

export function isOverdue(dueAt: string | null, now: number = Date.now()): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  return !Number.isNaN(due) && due < now;
}

/** First 12 chars of a sha256 for display; the full hash goes in the title. */
export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 12) : '—';
}

export function formatFileSize(bytes: number | string | null | undefined): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Triggers a browser download of `content` as `fileName` (JSON export). */
export function downloadTextFile(
  fileName: string,
  content: string,
  mime = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Opens a signed URL in a new tab without keeping a reference to the opener. */
export function openUrlInNewTab(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}

const SUBJECT_LABEL: Record<string, string> = {
  customer: 'Cliente',
  supplier: 'Proveedor',
  employee: 'Empleado',
  order: 'Venta',
  purchase_order: 'Orden de compra',
  expense: 'Gasto',
  invoice: 'Factura',
  payroll_run: 'Período de nómina',
};

/** Screens that open one record; the other subjects have no detail route. */
const SUBJECT_ROUTE: Record<string, string> = {
  customer: '/admin/customers',
  supplier: '/admin/inventory/suppliers',
  order: '/admin/orders',
  purchase_order: '/admin/orders/purchase-orders',
};

export interface InstanceSubjectView {
  text: string;
  /** Router link of the record's page, null when it has no detail route. */
  link: string[] | null;
}

/** "Sobre: Orden de compra #12" and where it leads; null when there is no subject. */
export function instanceSubject(
  type: string | null | undefined,
  id: number | null | undefined,
): InstanceSubjectView | null {
  if (!type || type === 'none' || id === null || id === undefined) return null;
  const base = SUBJECT_ROUTE[type];
  return {
    text: `Sobre: ${SUBJECT_LABEL[type] ?? type} #${id}`,
    link: base ? [base, String(id)] : null,
  };
}

/**
 * Text of a stored request value: a list field shows the label of each chosen
 * option (an AI step writes the option value), a yes/no field "Sí"/"No".
 */
export function fieldDisplayValue(
  raw: unknown,
  options?: { value: string; label: string }[],
): string {
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No';
  const one = (v: unknown) => options?.find((o) => o.value === v)?.label ?? String(v);
  return Array.isArray(raw) ? raw.map(one).join(', ') : one(raw);
}
