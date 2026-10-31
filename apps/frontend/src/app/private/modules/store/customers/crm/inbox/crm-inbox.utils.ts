import type { BadgeVariant } from '../../../../../../shared/components';
import {
  CrmChannel,
  CrmConversation,
  CrmConversationsQuery,
  CrmConversationStatus,
  CrmMessage,
  CrmMessageStatus,
  CrmPerson,
  InboxFilter,
} from './crm-inbox.interface';

export const CHANNEL_META: Record<CrmChannel, { label: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', icon: 'message-circle' },
  sms: { label: 'SMS', icon: 'smartphone' },
  email: { label: 'Correo', icon: 'mail' },
};

export const CONVERSATION_STATUS_META: Record<
  CrmConversationStatus,
  { label: string; variant: BadgeVariant }
> = {
  open: { label: 'Abierta', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  snoozed: { label: 'Pospuesta', variant: 'info' },
  closed: { label: 'Cerrada', variant: 'neutral' },
};

export const MESSAGE_STATUS_META: Record<
  CrmMessageStatus,
  { label: string; icon: string }
> = {
  queued: { label: 'En cola', icon: 'clock' },
  sent: { label: 'Enviado', icon: 'check' },
  delivered: { label: 'Entregado', icon: 'check-check' },
  read: { label: 'Leído', icon: 'check-check' },
  failed: { label: 'No se entregó', icon: 'circle-alert' },
  received: { label: 'Recibido', icon: 'check' },
};

export function personName(person: CrmPerson | null | undefined): string {
  if (!person) return '';
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}

/** Customer name, or the contact address when the sender is not linked yet. */
export function conversationTitle(conversation: CrmConversation): string {
  return personName(conversation.customer) || conversation.contact_address;
}

export function initials(text: string): string {
  const parts = text.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const value = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return value.toUpperCase() || '#';
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Day separator label in the browser's local time: Hoy, Ayer or the date. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Hoy';
  if (dayKey(date) === dayKey(yesterday)) return 'Ayer';
  return date.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function timeLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** List timestamp: time today, short date otherwise. */
export function listTimeLabel(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (dayKey(date) === dayKey(now)) return timeLabel(iso);
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

export interface MessageDayGroup {
  key: string;
  label: string;
  messages: CrmMessage[];
}

/** Messages in chronological order, grouped by local day. */
export function groupByDay(
  messages: CrmMessage[],
  now = new Date(),
): MessageDayGroup[] {
  const groups: MessageDayGroup[] = [];
  for (const message of messages) {
    const key = dayKey(new Date(message.created_at));
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.messages.push(message);
    } else {
      groups.push({ key, label: dayLabel(message.created_at, now), messages: [message] });
    }
  }
  return groups;
}

/** Merge by id and keep ascending order (oldest first). */
export function mergeMessages(
  current: CrmMessage[],
  incoming: CrmMessage[],
): CrmMessage[] {
  const byId = new Map<number, CrmMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Id for `client_request_id`: 8-64 letters, digits, `-` or `_`. */
export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** List query for a tab and the search box; a blank search sends no `q`. */
export function inboxQuery(
  filter: InboxFilter,
  search: string,
): CrmConversationsQuery {
  const q = search.trim() || undefined;
  switch (filter) {
    case 'unassigned':
      return { assigned: 'unassigned', q };
    case 'mine':
      return { assigned: 'me', q };
    case 'open':
      return { status: 'open', q };
    case 'closed':
      return { status: 'closed', q };
    default:
      return { q };
  }
}
