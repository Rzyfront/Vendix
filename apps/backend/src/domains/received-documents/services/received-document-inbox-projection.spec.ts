import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReceivedDocumentQueryDto } from '../dto/received-document.dto';
import {
  INBOX_STATES, LEGAL_STATUSES, InboxDocument, InboxEvent,
  inboxBaseWhere, inboxListWhere, inboxStateWhere, legalStatusWhere, projectReceivedDocumentInbox,
} from './received-document-inbox-projection';

const arrived = new Date('2026-10-13T10:00:00Z');
const document = (patch: Partial<InboxDocument> = {}): InboxDocument => ({
  document_type: 'invoice', processing_status: 'ready', validation_status: 'valid',
  structural_validation_status: 'valid', accepted_at: null, created_at: arrived, events: [], ...patch,
});
const event = (event_code: string, status = 'accepted'): InboxEvent => ({ event_type: 'BUYER_DIAN_EVENT', event_code, status });

/** Small predicate evaluator for the exact atoms emitted by the query builder. */
function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every((item) => matches(record, item));
    if (key === 'OR') return (condition as Record<string, unknown>[]).some((item) => matches(record, item));
    if (key === 'NOT') return (Array.isArray(condition) ? condition : [condition]).every((item) => !matches(record, item));
    const value = record[key];
    if (condition != null && typeof condition === 'object') {
      const filter = condition as Record<string, unknown>;
      if ('some' in filter) return ((value ?? []) as Record<string, unknown>[]).some((row) => matches(row, filter.some as Record<string, unknown>));
      if ('in' in filter) return (filter.in as unknown[]).includes(value);
      if ('notIn' in filter) return !(filter.notIn as unknown[]).includes(value);
      if ('not' in filter) return filter.not === null ? value != null : value !== filter.not;
    }
    return value === condition;
  });
}

describe('received document inbox projection', () => {
  it('distinguishes invoice claims from a rejected 031 transmission and from accepted 030/032', () => {
    expect(projectReceivedDocumentInbox(document({ events: [event('031')] })).inbox_state).toBe('reclaimed');
    const rejected = projectReceivedDocumentInbox(document({ events: [event('031', 'rejected')] }));
    expect(rejected).toMatchObject({ inbox_state: 'requires_review', legal_status: 'none', event_delivery_status: 'rejected' });
    for (const code of ['030', '032']) {
      expect(projectReceivedDocumentInbox(document({ events: [event(code)] }))).toMatchObject({ inbox_state: 'new', legal_status: 'none' });
    }
  });

  it('recognizes accepted timestamps and 033/034 without confusing validation with legal acceptance', () => {
    for (const patch of [{ accepted_at: arrived }, { events: [event('033')] }, { events: [event('034')] }]) {
      expect(projectReceivedDocumentInbox(document(patch))).toMatchObject({ inbox_state: 'accepted', legal_status: 'accepted' });
    }
    expect(projectReceivedDocumentInbox(document()).legal_status).toBe('none');
    expect(projectReceivedDocumentInbox(document({ document_type: 'credit_note' })).legal_status).toBe('not_applicable');
  });

  it('prioritizes uncertainty and conflicts while preserving both legal evidence flags', () => {
    for (const status of ['unknown', 'sending', 'preparing', 'prepared', 'unexpected']) {
      expect(projectReceivedDocumentInbox(document({ accepted_at: arrived, events: [event('030', status)] })))
        .toMatchObject({ inbox_state: 'requires_review', legal_status: 'accepted', legal_flags: { accepted: true, reclaimed: false } });
    }
    const conflict = projectReceivedDocumentInbox(document({ accepted_at: arrived, events: [event('031')] }));
    expect(conflict).toMatchObject({ inbox_state: 'requires_review', legal_status: 'conflict', legal_flags: { accepted: true, reclaimed: true } });
    expect(conflict.blocking_reasons).toContain('legal_evidence_conflict');
  });

  it('keeps OCR/pending validation new and adds explanatory reasons rather than an AI state', () => {
    const pending = projectReceivedDocumentInbox(document({ processing_status: 'pending_ocr', validation_status: 'pending' }));
    expect(pending).toMatchObject({ inbox_state: 'new', arrived_at: arrived });
    expect(pending.blocking_reasons).toEqual(['document_reading_pending', 'validation_pending']);
    expect(pending).not.toHaveProperty('ai_status');
    expect(projectReceivedDocumentInbox(document({ processing_status: 'processing' })).inbox_state).toBe('new');
    for (const validation_status of ['invalid', 'needs_review']) {
      expect(projectReceivedDocumentInbox(document({ validation_status })).inbox_state).toBe('requires_review');
    }
    expect(projectReceivedDocumentInbox(document({ processing_status: 'error' })).inbox_state).toBe('requires_review');
  });

  it('makes exclusive database categories agree with row projection for every evidence combination', () => {
    const eventSets = [[], [event('030')], [event('031')], [event('031', 'rejected')], [event('033')],
      [event('034')], [event('030', 'unknown')], [event('031'), event('033')], [event('033', 'preparation_failed')]];
    for (const events of eventSets) {
      for (const processing_status of ['ready', 'error', 'pending_ocr', 'processing']) {
        for (const validation_status of ['valid', 'invalid', 'needs_review', 'pending']) {
          for (const accepted_at of [null, arrived]) {
            const row = document({ events, processing_status, validation_status, accepted_at });
            const projection = projectReceivedDocumentInbox(row);
            const matching = INBOX_STATES.filter((state) => matches(row as unknown as Record<string, unknown>, inboxStateWhere(state) as Record<string, unknown>));
            expect(matching).toEqual([projection.inbox_state]);
            const legal = LEGAL_STATUSES.filter((state) => matches(row as unknown as Record<string, unknown>, legalStatusWhere(state) as Record<string, unknown>));
            expect(legal).toEqual([projection.legal_status]);
          }
        }
      }
    }
  });

  it('keeps a legal accepted filter independent from attention and fails closed without an entity', () => {
    const row = document({ accepted_at: arrived, events: [event('030', 'unknown')] });
    expect(matches(row as unknown as Record<string, unknown>, legalStatusWhere('accepted') as Record<string, unknown>)).toBe(true);
    expect(projectReceivedDocumentInbox(row).inbox_state).toBe('requires_review');
    const base = inboxBaseWhere({ organization_id: 3, accounting_entity_id: null, store_id: 21 }, {});
    expect(base).toMatchObject({ organization_id: 3, accounting_entity_id: { in: [] }, store_id: 21 });
    const list = inboxListWhere({ organization_id: 3, accounting_entity_id: 8, store_id: 21 }, { page: 1, limit: 25, inbox_state: 'requires_review', legal_status: 'accepted' });
    expect(list.AND).toEqual(expect.arrayContaining([inboxStateWhere('requires_review'), legalStatusWhere('accepted')]));
  });

  it('validates optional filters through the real DTO transform/whitelist pipeline', () => {
    const validate = (input: object) => validateSync(plainToInstance(ReceivedDocumentQueryDto, input, { enableImplicitConversion: true }), { whitelist: true, forbidNonWhitelisted: true });
    expect(validate({ page: '2', limit: '100', sort: 'inbox', inbox_state: 'new', legal_status: 'accepted', document_type: 'invoice' })).toHaveLength(0);
    expect(validate({})).toHaveLength(0);
    for (const input of [{ inbox_state: 'rejected' }, { legal_status: 'invalid' }, { sort: 'id' }, { document_type: 'other' }, { limit: 101 }, { raw_payload: true }]) {
      expect(validate(input).length).toBeGreaterThan(0);
    }
  });
});
