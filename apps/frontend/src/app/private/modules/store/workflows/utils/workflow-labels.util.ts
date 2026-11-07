import {
  WorkflowDefinitionRow,
  WorkflowInstanceStatus,
} from '../interfaces/workflow.interfaces';

export type BadgeTone = 'success' | 'neutral' | 'error' | 'primary' | 'warning' | 'info';

export const DEFINITION_STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

/** "Borrador" / "Publicado v3" / "Archivado". */
export function definitionStatusLabel(row: WorkflowDefinitionRow): string {
  if (row.status === 'published' && row.published_version) {
    return `Publicado v${row.published_version.version}`;
  }
  return DEFINITION_STATUS_LABEL[row.status] ?? row.status;
}

export function definitionStatusTone(status: string): BadgeTone {
  if (status === 'published') return 'success';
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
  task_completed: 'Etapa completada',
  vote: 'Voto registrado',
  claimed: 'Tarea tomada',
  forced: 'Movida por administración',
  cancelled: 'Cancelada',
  escalated: 'Escalada',
  unassigned: 'Sin responsable',
  failed: 'Error',
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type;
}

export const OUTCOME_LABEL: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
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
