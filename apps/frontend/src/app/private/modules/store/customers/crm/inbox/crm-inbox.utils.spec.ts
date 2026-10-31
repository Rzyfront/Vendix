import {
  conversationTitle,
  dayLabel,
  groupByDay,
  inboxQuery,
  initials,
  listTimeLabel,
  mergeMessages,
  newClientRequestId,
  personName,
} from './crm-inbox.utils';
import { CrmConversation, CrmMessage } from './crm-inbox.interface';

/** ISO string of a local wall-clock time, so day logic is TZ-independent. */
const local = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

const NOW = new Date(2026, 9, 31, 12, 0);

const message = (id: number, created_at = local(2026, 10, 31)): CrmMessage => ({
  id,
  conversation_id: 1,
  direction: 'inbound',
  channel: 'whatsapp',
  status: 'received',
  body: `m${id}`,
  template_name: null,
  template_language: null,
  media: [],
  sent_by: null,
  error_code: null,
  error_message: null,
  created_at,
  sent_at: null,
  delivered_at: null,
  read_at: null,
  failed_at: null,
});

const conversation = (patch: Partial<CrmConversation> = {}): CrmConversation => ({
  id: 1,
  channel: 'whatsapp',
  contact_address: '+573001112233',
  status: 'open',
  customer: null,
  assigned_user: null,
  social_channel_id: null,
  unread_count: 0,
  last_message_at: null,
  last_inbound_at: null,
  snoozed_until: null,
  closed_at: null,
  created_at: local(2026, 10, 1),
  window_open: true,
  window_expires_at: null,
  ...patch,
});

describe('crm-inbox.utils', () => {
  describe('inboxQuery', () => {
    it('maps each tab to its API filter', () => {
      expect(inboxQuery('all', '')).toEqual({ q: undefined });
      expect(inboxQuery('unassigned', '')).toEqual({ assigned: 'unassigned', q: undefined });
      expect(inboxQuery('mine', '')).toEqual({ assigned: 'me', q: undefined });
      expect(inboxQuery('open', '')).toEqual({ status: 'open', q: undefined });
      expect(inboxQuery('closed', '')).toEqual({ status: 'closed', q: undefined });
    });

    it('sends the trimmed search and drops a blank one', () => {
      expect(inboxQuery('mine', '  ana  ')).toEqual({ assigned: 'me', q: 'ana' });
      expect(inboxQuery('all', '   ')).toEqual({ q: undefined });
    });
  });

  describe('personName and conversationTitle', () => {
    it('joins the present name parts', () => {
      expect(personName({ id: 1, first_name: 'Ana', last_name: 'Gómez' })).toBe('Ana Gómez');
      expect(personName({ id: 1, first_name: 'Ana', last_name: null })).toBe('Ana');
      expect(personName(null)).toBe('');
    });

    it('falls back to the contact address for an unlinked sender', () => {
      expect(conversationTitle(conversation())).toBe('+573001112233');
      expect(
        conversationTitle(
          conversation({ customer: { id: 9, first_name: 'Luis', last_name: 'Paz' } }),
        ),
      ).toBe('Luis Paz');
    });
  });

  describe('initials', () => {
    it('takes the first letter of the first two words', () => {
      expect(initials('ana gómez ruiz')).toBe('AG');
      expect(initials('Ana')).toBe('A');
    });

    it('returns # when there is no letter or digit', () => {
      expect(initials('+--')).toBe('#');
    });
  });

  describe('dayLabel and listTimeLabel', () => {
    it('labels today and yesterday', () => {
      expect(dayLabel(local(2026, 10, 31, 0, 5), NOW)).toBe('Hoy');
      expect(dayLabel(local(2026, 10, 30, 23, 59), NOW)).toBe('Ayer');
    });

    it('shows the year only for another year', () => {
      expect(dayLabel(local(2026, 10, 15), NOW)).toContain('octubre');
      expect(dayLabel(local(2026, 10, 15), NOW)).not.toContain('2026');
      expect(dayLabel(local(2025, 10, 15), NOW)).toContain('2025');
    });

    it('list rows show nothing without a date and no time for older days', () => {
      expect(listTimeLabel(null, NOW)).toBe('');
      expect(listTimeLabel(local(2026, 10, 15), NOW)).toContain('15');
    });
  });

  describe('groupByDay', () => {
    it('groups consecutive messages of the same local day', () => {
      const groups = groupByDay(
        [
          message(1, local(2026, 10, 30, 9)),
          message(2, local(2026, 10, 30, 22)),
          message(3, local(2026, 10, 31, 8)),
        ],
        NOW,
      );
      expect(groups.map((g) => g.label)).toEqual(['Ayer', 'Hoy']);
      expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([[1, 2], [3]]);
    });

    it('returns no groups for no messages', () => {
      expect(groupByDay([], NOW)).toEqual([]);
    });
  });

  describe('mergeMessages', () => {
    it('dedupes by id, keeps the incoming copy and sorts oldest first', () => {
      const delivered = { ...message(2), status: 'delivered' as const };
      const merged = mergeMessages([message(3), message(2)], [delivered, message(1)]);
      expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
      expect(merged[1].status).toBe('delivered');
    });
  });

  describe('newClientRequestId', () => {
    it('matches the API format and is unique per call', () => {
      const a = newClientRequestId();
      const b = newClientRequestId();
      expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(a).not.toBe(b);
    });
  });
});
