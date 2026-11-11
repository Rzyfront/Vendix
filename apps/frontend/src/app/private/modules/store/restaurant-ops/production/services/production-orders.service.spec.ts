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
    req.flush({ success: true, data: payload });
  });
});
