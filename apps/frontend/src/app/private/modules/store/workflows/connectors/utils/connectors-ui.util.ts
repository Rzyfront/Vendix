import { BadgeVariant } from '../../../../../../shared/components/index';
import { ConnectorKey, ConnectorState } from '../interfaces/connectors.interfaces';

export const CONNECTOR_ICON: Record<ConnectorKey, string> = {
  http: 'globe',
  inbound_webhook: 'webhook',
  email_out: 'mail',
  email_in: 'inbox',
  whatsapp: 'message-circle',
  dian: 'receipt',
};

export const CONNECTOR_STATE_LABEL: Record<ConnectorState, string> = {
  connected: 'Conectado',
  not_connected: 'No conectado',
  available: 'Disponible',
};

export const CONNECTOR_STATE_VARIANT: Record<ConnectorState, BadgeVariant> = {
  connected: 'success',
  not_connected: 'warning',
  available: 'info',
};

/** Where the admin fixes what a connector is missing (only screens that exist). */
export const CONNECTOR_FIX_LINK: Partial<Record<ConnectorKey, { route: string; label: string }>> = {
  http: { route: '/admin/workflows/integrations', label: 'Ir a Integraciones' },
  inbound_webhook: { route: '/admin/workflows', label: 'Abrir mis flujos' },
  email_in: { route: '/admin/workflows', label: 'Abrir mis flujos' },
  whatsapp: { route: '/admin/integrations/channels', label: 'Conectar WhatsApp' },
  dian: { route: '/admin/invoicing/dian-config', label: 'Configurar facturación' },
};

const TRIGGER_LABEL: Record<string, string> = {
  webhook: 'Webhook de entrada',
  email: 'Correo entrante',
};

export function triggerLabel(kind: string): string {
  return TRIGGER_LABEL[kind] ?? kind;
}

const TYPE_LABEL: Record<string, string> = {
  text: 'texto',
  int: 'número entero',
  number: 'número',
  money: 'monto',
  date: 'fecha',
  boolean: 'sí/no',
  enum: 'opción',
  assignee: 'responsable',
  id: 'identificador',
};

export function inputTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
