import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductionDaySupplies } from '../interfaces';
import { ProductionOrdersService } from './production-orders.service';

describe('ProductionOrdersService.getDaySupplies — S5', () => {
  let service: ProductionOrdersService;
  let http: HttpTestingController;

  const payload: ProductionDaySupplies = {
    date: '2026-11-11',
    timezone: 'America/Bogota',
    orders_total: 1,
    orders_completed: 1,
    orders_without_breakdown: 0,
    supplies: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductionOrdersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the restaurant endpoint by default', () => {
    let result: ProductionDaySupplies | undefined;
    service.getDaySupplies('2026-11-11').subscribe((r) => (result = r));

    const req = http.expectOne((r) => r.url.endsWith('/store/production-orders/day/supplies'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('date')).toBe('2026-11-11');
    req.flush({ success: true, data: payload });

    expect(result).toEqual(payload);
  });

  it('reads the Planta endpoint for the manufacturing scope', () => {
    service.getDaySupplies('2026-11-11', 'manufacturing').subscribe();

    const req = http.expectOne((r) =>
      r.url.endsWith('/store/manufacturing/orders/day/supplies'),
    );
    expect(req.request.params.get('date')).toBe('2026-11-11');
    // Without a plant session the whole store is asked for, as before QUI-1013.
    expect(req.request.params.has('plant_id')).toBeFalse();
    req.flush({ success: true, data: payload });
  });

  describe('QUI-1013 — plant of the production session', () => {
    const day = {
      date: '2026-11-11',
      timezone: 'America/Bogota',
      server_now: new Date().toISOString(),
      summary: { waiting: 0, in_progress: 0, completed: 0 },
      cards: [],
      next_cursor: null,
    };

    it('sends plant_id on the Planta supplies of a plant', () => {
      service.getDaySupplies('2026-11-11', 'manufacturing', 3).subscribe();
      const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/orders/day/supplies'));
      expect(req.request.params.get('plant_id')).toBe('3');
      req.flush({ success: true, data: payload });
    });

    it('sends plant_id on every page of the Planta day', () => {
      service.getDay('2026-11-11', 'manufacturing', { limit: 100, cursor: 'c1' }, 4).subscribe();
      const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/orders/day'));
      expect(req.request.params.get('plant_id')).toBe('4');
      expect(req.request.params.get('cursor')).toBe('c1');
      req.flush({ success: true, data: day });
    });

    it('never sends plant_id to the restaurant endpoints', () => {
      service.getDaySupplies('2026-11-11', 'restaurant', 3).subscribe();
      const req = http.expectOne((r) => r.url.endsWith('/store/production-orders/day/supplies'));
      expect(req.request.params.has('plant_id')).toBeFalse();
      req.flush({ success: true, data: payload });
    });

    it('omits plant_id when the session has no plant (one plant or none)', () => {
      service.getDay('2026-11-11', 'manufacturing', undefined, null).subscribe();
      const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/orders/day'));
      expect(req.request.params.has('plant_id')).toBeFalse();
      req.flush({ success: true, data: day });
    });
  });
});
