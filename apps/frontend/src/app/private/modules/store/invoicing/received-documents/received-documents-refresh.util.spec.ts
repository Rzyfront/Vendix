import type { ReceivedDocument } from './received-documents.interface';
import { receivedInboxCanPoll, receivedInboxContextKey, receivedInboxMembershipChanged, receivedInboxNewRowCount, receivedInboxProtectedRows, receivedInboxRefreshDelay } from './received-documents-refresh.util';

function document(id: number, overrides: Partial<ReceivedDocument> = {}): ReceivedDocument {
  return {
    id, store_id: 1, document_type: 'invoice', source_channel: 'xml', issuer_tax_id: '900123', issuer_name: 'Proveedor',
    receiver_tax_id: '900456', receiver_name: 'Comprador', invoice_number: `F-${id}`, document_key: null,
    issue_date: '2026-10-13', due_date: null, currency: 'COP', subtotal_amount: '100', discount_amount: '0', tax_amount: '0', total_amount: '100',
    processing_status: 'ready', validation_status: 'valid', review_status: 'pending', matching_status: 'unmatched',
    fiscal_status: 'pending', posting_status: 'pending', version: 1, created_at: '2026-10-13T12:00:00Z', updated_at: '2026-10-13T12:00:00Z',
    inbox_state: 'new', legal_status: 'none', ...overrides,
  };
}

describe('received inbox refresh policy and protected projection', () => {
  it('polls at 30 seconds and backs off 60/120/240 up to 300 seconds', () => {
    expect([0, 1, 2, 3, 4, 100].map(receivedInboxRefreshDelay)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(receivedInboxRefreshDelay(0)).toBe(30_000);
  });
  it('pauses polling while hidden, offline or fiscal scope is not ready', () => {
    expect(receivedInboxCanPoll(true, true, true)).toBe(true);
    expect(receivedInboxCanPoll(false, true, true)).toBe(false);
    expect(receivedInboxCanPoll(true, false, true)).toBe(false);
    expect(receivedInboxCanPoll(true, true, false)).toBe(false);
  });
  it('separates user/store/org tenant contexts even with identical store routes and queries', () => {
    const query = { page: 2, limit: 25, sort: 'inbox' as const };
    expect(receivedInboxContextKey('store', query, 'user1:store1:org1')).not.toBe(receivedInboxContextKey('store', query, 'user2:store2:org2'));
    expect(receivedInboxContextKey('store', query)).not.toBe(receivedInboxContextKey('organization', query));
    expect(receivedInboxContextKey('organization', { ...query, store_id: 1 })).not.toBe(receivedInboxContextKey('organization', { ...query, store_id: 2 }));
    expect(receivedInboxContextKey('store', { page: 2, search: 'NIT' })).toBe(receivedInboxContextKey('store', { search: 'NIT', page: 2 }));
  });
  it('keeps row order and captured fields while compact same-ID statuses change', () => {
    const current = [document(1, { issuer_name: 'Draft visible', metadata: { draft: true } }), document(2)];
    const incoming = [document(3), document(1, { issuer_name: 'Changed', inbox_state: 'requires_review', legal_status: 'accepted', version: 2 })];
    const visible = receivedInboxProtectedRows(current, incoming);
    expect(visible.map((row) => row.id)).toEqual([1, 2]);
    expect(visible[0].issuer_name).toBe('Draft visible');
    expect(visible[0].metadata).toEqual({ draft: true });
    expect(visible[0].inbox_state).toBe('requires_review');
    expect(visible[0].legal_status).toBe('accepted');
    expect(visible[0].version).toBe(2);
    expect(current[0].version).toBe(1);
    expect(visible[1]).toBe(current[1]);
    expect(receivedInboxNewRowCount(current, incoming)).toBe(1);
    expect(receivedInboxMembershipChanged(current, incoming)).toBe(true);
  });
  it('does not treat same-ID status changes as new invoices or reset a page', () => {
    const current = [document(1)];
    const incoming = [document(1, { inbox_state: 'accepted' })];
    expect(receivedInboxMembershipChanged(current, incoming)).toBe(false);
    expect(receivedInboxNewRowCount(current, incoming)).toBe(0);
  });
});
