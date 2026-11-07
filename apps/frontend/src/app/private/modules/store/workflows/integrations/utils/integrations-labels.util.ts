import {
  WORKFLOW_WEBHOOK_EVENTS,
  WorkflowWebhookEvent,
} from '../../../../../../shared/workflows/contract';
import {
  ApiKeyRow,
  ApiKeyScope,
  WebhookDeliveryStatus,
} from '../interfaces/integrations.interfaces';

/** Event types an endpoint can subscribe to: the shared contract list. */
export const WEBHOOK_EVENTS = WORKFLOW_WEBHOOK_EVENTS;

export type WebhookEventType = WorkflowWebhookEvent;

export const WEBHOOK_EVENT_LABEL: Record<WebhookEventType, string> = {
  'workflow.instance.started': 'Solicitud iniciada',
  'workflow.instance.transitioned': 'Solicitud cambió de etapa',
  'workflow.instance.completed': 'Solicitud completada',
  'workflow.instance.rejected': 'Solicitud rechazada',
  'workflow.task.created': 'Tarea creada',
  'workflow.task.completed': 'Tarea completada',
  'workflow.task.overdue': 'Tarea vencida',
};

export function webhookEventLabel(event: string): string {
  return (WEBHOOK_EVENT_LABEL as Record<string, string>)[event] ?? (event === 'ping' ? 'Prueba' : event);
}

export const API_KEY_SCOPES: { value: ApiKeyScope; label: string; hint: string }[] = [
  { value: 'workflows:read', label: 'Lectura', hint: 'Consultar flujos, solicitudes y tareas.' },
  { value: 'workflows:write', label: 'Escritura', hint: 'Iniciar solicitudes y completar tareas.' },
];

export function scopeLabel(scope: string): string {
  return API_KEY_SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

export type ApiKeyState = 'active' | 'revoked' | 'expired';

export function apiKeyState(row: ApiKeyRow, now = Date.now()): ApiKeyState {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'active';
}

export const API_KEY_STATE_LABEL: Record<ApiKeyState, string> = {
  active: 'Activa',
  revoked: 'Revocada',
  expired: 'Expirada',
};

/** Badge class key understood by the table's `status` badges. */
export const DELIVERY_BADGE: Record<WebhookDeliveryStatus, string> = {
  delivered: 'completed',
  failed: 'error',
  pending: 'pending',
  dead: 'suspended',
};

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatus, string> = {
  delivered: 'Entregado',
  failed: 'Fallido',
  pending: 'Pendiente',
  dead: 'Agotado',
};

export function truncate(text: string | null | undefined, max = 80): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
