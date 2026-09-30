import { ErrorCodes } from 'src/common/errors';
import { canReassignOrderToTable } from './order-table-reassignment-policy.util';

describe('canReassignOrderToTable', () => {
  it('registers the three route-facing codes at their real HTTP statuses', () => {
    expect(ErrorCodes.ORD_TABLE_REASSIGN_ORDER_STATE_001.httpStatus).toBe(409);
    expect(ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.httpStatus).toBe(409);
    expect(ErrorCodes.TABLE_SESSION_NOT_FOUND.httpStatus).toBe(404);
  });

  const base = () => ({
    state: 'created',
    active_financial_split_id: null,
    table_sessions: [{ id: 1, closed_at: new Date() }],
    payments: [],
    invoices: [],
  });

  it('allows a previously closed, unpaid table order', () => {
    expect(canReassignOrderToTable(base())).toEqual({ eligible: true });
  });

  it.each(['cancelled', 'refunded'])('rejects terminal state %s with details.state', (state) => {
    expect(canReassignOrderToTable({ ...base(), state })).toEqual({
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_ORDER_STATE_001.code,
      details: { state },
    });
  });

  it.each(['succeeded', 'captured', 'partially_refunded', 'refunded'])(
    'rejects settled payment %s', (state) => {
      expect(canReassignOrderToTable({ ...base(), payments: [{ state }] })).toEqual({
        eligible: false,
        errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
        details: { reason: 'settled_payment' },
      });
    },
  );

  it('allows an unsettled payment without other blockers', () => {
    expect(canReassignOrderToTable({ ...base(), payments: [{ state: 'pending' }] }))
      .toEqual({ eligible: true });
  });

  it('rejects an active financial split', () => {
    expect(canReassignOrderToTable({ ...base(), active_financial_split_id: 42 })).toEqual({
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
      details: { reason: 'active_financial_split' },
    });
  });

  it.each(['validated', 'sent', 'accepted', 'rejected'])(
    'rejects issued or numbered invoice %s', (status) => {
      expect(canReassignOrderToTable({ ...base(), invoices: [{ status }] })).toEqual({
        eligible: false,
        errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
        details: { reason: 'issued_invoice' },
      });
    },
  );

  it.each(['draft', 'cancelled', 'voided'])(
    'allows invoice status %s without other financial blockers', (status) => {
      expect(canReassignOrderToTable({ ...base(), invoices: [{ status }] }))
        .toEqual({ eligible: true });
    },
  );

  it('does not reassign to an order with a second open session', () => {
    expect(canReassignOrderToTable({ ...base(), table_sessions: [{ id: 1, closed_at: null }] }))
      .toEqual({ eligible: false, errorCode: ErrorCodes.TABLE_SESSION_ALREADY_OPEN.code });
  });

  it('rejects orders that never had a table', () => {
    expect(canReassignOrderToTable({ ...base(), table_sessions: [] })).toEqual({
      eligible: false,
      errorCode: ErrorCodes.TABLE_SESSION_NOT_FOUND.code,
    });
  });
});
