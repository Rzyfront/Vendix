import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

describe('AuditInterceptor — extractIdFromUrl (B3, release-855)', () => {
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    interceptor = new AuditInterceptor({} as AuditService);
  });

  function extractIdFromUrl(url: string): number | null {
    return (interceptor as any).extractIdFromUrl(url);
  }

  it('resolves the order id right after /orders/, not a nested flow segment', () => {
    expect(extractIdFromUrl('/api/store/orders/42/flow/pay')).toBe(42);
  });

  it('resolves the order id even with a nested item id in /items/:itemId/deliver', () => {
    expect(extractIdFromUrl('/api/store/orders/42/items/999/deliver')).toBe(42);
  });

  it('resolves the order id even with a nested refund id', () => {
    expect(extractIdFromUrl('/api/store/orders/42/flow/refunds/7/resolve')).toBe(42);
  });

  it('resolves the order id when the sub-route has no trailing numeric segment', () => {
    expect(extractIdFromUrl('/api/store/orders/42/flow/refund')).toBe(42);
  });

  it('strips query params before resolving the order id', () => {
    expect(extractIdFromUrl('/api/store/orders/42/flow/pay?foo=bar')).toBe(42);
  });

  it('falls back to the last numeric segment for non-order resources', () => {
    expect(extractIdFromUrl('/api/store/customers/17')).toBe(17);
  });

  it('falls back to the last numeric segment for a nested non-order resource', () => {
    expect(extractIdFromUrl('/api/store/products/17/variants/5')).toBe(5);
  });

  it('returns null when there is no numeric segment at all', () => {
    expect(extractIdFromUrl('/api/store/orders')).toBeNull();
  });

  it('does not treat a long numeric-looking segment (e.g. a timestamp) as an id', () => {
    expect(extractIdFromUrl('/api/store/orders/1234567890123')).toBeNull();
  });
});
