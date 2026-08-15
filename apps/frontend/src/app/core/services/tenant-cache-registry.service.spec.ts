import { TestBed } from '@angular/core/testing';
import { TenantCacheRegistry } from './tenant-cache-registry.service';

/**
 * QUI-563 Fase 2 — Tenant cache invalidation bus.
 *
 * Pairs with the StoreScopedCache helper spec. The bus registers clear()
 * callbacks from services and fires them on demand (typically from the
 * environment switch service). These specs verify the contract that the
 * switch service depends on:
 *
 *   - register/unregister idempotency under re-registration
 *   - clearAll() runs every registered clear() in registration order
 *   - a throwing clear() never aborts the rest of the bus
 *   - the clearAll$ observable fires exactly once per clearAll() call
 */
describe('TenantCacheRegistry', () => {
  let registry: TenantCacheRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TenantCacheRegistry],
    });
    registry = TestBed.inject(TenantCacheRegistry);
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
  });

  describe('register()', () => {
    it('increments the size on each unique id', () => {
      registry.register('a', () => {});
      registry.register('b', () => {});
      expect(registry.size).toBe(2);
    });

    it('replaces the previous callback when the same id is re-registered', () => {
      const calls: string[] = [];
      registry.register('shared', () => calls.push('first'), 'FirstService');
      registry.register('shared', () => calls.push('second'), 'SecondService');
      expect(registry.size).toBe(1);
      registry.clearAll();
      expect(calls).toEqual(['second']);
    });
  });

  describe('unregister()', () => {
    it('drops a registered callback and returns true', () => {
      registry.register('a', () => {});
      expect(registry.unregister('a')).toBeTrue();
      expect(registry.size).toBe(0);
    });

    it('returns false when the id was not registered', () => {
      expect(registry.unregister('never-registered')).toBeFalse();
    });
  });

  describe('clearAll() — the contract the environment switch service relies on', () => {
    it('invokes every registered clear() callback', () => {
      const calls: string[] = [];
      registry.register('a', () => calls.push('a'));
      registry.register('b', () => calls.push('b'));
      registry.register('c', () => calls.push('c'));

      registry.clearAll();

      expect(calls.sort()).toEqual(['a', 'b', 'c']);
    });

    it('runs callbacks in registration order', () => {
      const order: string[] = [];
      registry.register('first', () => order.push('first'));
      registry.register('second', () => order.push('second'));
      registry.register('third', () => order.push('third'));

      registry.clearAll();

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('continues after a throwing clear() and logs the error', () => {
      const calls: string[] = [];
      const consoleError = spyOn(console, 'error');
      registry.register('boom', () => {
        throw new Error('boom from boom');
      });
      registry.register('after-boom', () => calls.push('after-boom'));

      expect(() => registry.clearAll()).not.toThrow();
      expect(calls).toEqual(['after-boom']);
      expect(consoleError).toHaveBeenCalled();
    });

    it('is a no-op when nothing is registered', () => {
      expect(() => registry.clearAll()).not.toThrow();
    });

    it('can be invoked multiple times', () => {
      const calls: string[] = [];
      registry.register('a', () => calls.push('a'));
      registry.clearAll();
      registry.clearAll();
      expect(calls).toEqual(['a', 'a']);
    });
  });

  describe('onCleared observable', () => {
    it('emits exactly once per clearAll() call', (done) => {
      let count = 0;
      registry.onCleared.subscribe(() => {
        count++;
        if (count === 3) {
          expect(count).toBe(3);
          done();
        }
      });
      registry.register('a', () => {});
      registry.clearAll();
      registry.clearAll();
      registry.clearAll();
    });

    it('completes on registry destruction', () => {
      let completed = false;
      const sub = registry.onCleared.subscribe({ complete: () => (completed = true) });
      registry.ngOnDestroy();
      expect(completed).toBeTrue();
      sub.unsubscribe();
    });
  });
});
