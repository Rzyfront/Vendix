import { STAFF_EVENT_WHITELIST } from './table-sessions.controller';

describe('staff table-session SSE whitelist', () => {
  it('forwards session_paid while retaining default-deny', () => {
    expect(STAFF_EVENT_WHITELIST('session_paid')).toBe(true);
    expect(STAFF_EVENT_WHITELIST('session_paid_extra')).toBe(false);
    expect(STAFF_EVENT_WHITELIST('payment.refunded')).toBe(false);
    expect(STAFF_EVENT_WHITELIST('unknown')).toBe(false);
  });
});
