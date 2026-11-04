import { ACCESS_AUDIT_PREFIX, AccessAuditLogger } from './access-audit.logger';
import { AccessAuditEvent } from './access-audit.types';

const event = (over: Partial<AccessAuditEvent> = {}): AccessAuditEvent => ({
  source: 'backend',
  surface: 'api',
  store_id: 3,
  organization_id: 2,
  user_id: 9,
  role: 'admin',
  key: 'restaurant_ops_recipes',
  industry: ['retail'],
  decision: 'would_block',
  layer: 'industry',
  route: 'GET /api/store/recipes/:id',
  mode: 'audit',
  ...over,
});

describe('AccessAuditLogger', () => {
  let logger: AccessAuditLogger;
  let log: jest.SpyInstance;

  beforeEach(() => {
    logger = new AccessAuditLogger();
    log = jest
      .spyOn((logger as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('writes one ACCESS_AUDIT line with single-line JSON and the exact fields', () => {
    logger.record(event(), Date.parse('2026-11-03T10:00:00.000Z'));
    expect(log).toHaveBeenCalledTimes(1);
    const line: string = log.mock.calls[0][0];
    expect(line.startsWith(ACCESS_AUDIT_PREFIX)).toBe(true);
    expect(ACCESS_AUDIT_PREFIX).toBe('ACCESS_AUDIT ');
    expect(line).not.toContain('\n');
    expect(JSON.parse(line.slice(ACCESS_AUDIT_PREFIX.length))).toEqual({
      source: 'backend',
      surface: 'api',
      store_id: 3,
      organization_id: 2,
      user_id: 9,
      role: 'admin',
      key: 'restaurant_ops_recipes',
      industry: ['retail'],
      decision: 'would_block',
      layer: 'industry',
      route: 'GET /api/store/recipes/:id',
      mode: 'audit',
      ts: '2026-11-03T10:00:00.000Z',
    });
  });

  it('drops any field outside the contract (no PII leaks)', () => {
    logger.record({ ...event(), email: 'a@b.co', ip: '1.1.1.1' } as any);
    const parsed = JSON.parse(log.mock.calls[0][0].slice(13));
    expect(parsed).not.toHaveProperty('email');
    expect(parsed).not.toHaveProperty('ip');
  });

  it('dedupes identical events inside 60 s and writes again after', () => {
    const t0 = 1_000_000;
    logger.record(event(), t0);
    logger.record(event(), t0 + 59_000);
    expect(log).toHaveBeenCalledTimes(1);
    logger.record(event(), t0 + 61_000);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe events that differ in any dedupe field', () => {
    logger.record(event(), 1);
    logger.record(event({ user_id: 10 }), 1);
    logger.record(event({ key: 'memberships_plans' }), 1);
    logger.record(event({ decision: 'blocked' }), 1);
    logger.record(event({ route: 'POST /api/store/recipes' }), 1);
    expect(log).toHaveBeenCalledTimes(5);
  });

  it('truncates the route to 200 chars and strips the query string', () => {
    logger.record(event({ route: `/${'a'.repeat(300)}?token=secret` }));
    const parsed = JSON.parse(log.mock.calls[0][0].slice(13));
    expect(parsed.route).toHaveLength(200);
    expect(parsed.route).not.toContain('secret');
    logger.record(event({ route: '/admin/x?y=1', user_id: 77 }));
    expect(JSON.parse(log.mock.calls[1][0].slice(13)).route).toBe('/admin/x');
  });
});
