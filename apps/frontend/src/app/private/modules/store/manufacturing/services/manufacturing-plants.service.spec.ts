import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ManufacturingPlant } from '../interfaces';
import { ManufacturingPlantsService } from './manufacturing-plants.service';

/** QUI-1013 — the plants API used by Configuración, the order form and the session. */
describe('ManufacturingPlantsService (QUI-1013)', () => {
  let service: ManufacturingPlantsService;
  let http: HttpTestingController;

  const plant: ManufacturingPlant = {
    id: 1,
    store_id: 1,
    name: 'Planta principal',
    input_location_id: 10,
    output_location_id: 20,
    manager_user_id: null,
    is_active: true,
    is_main: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ManufacturingPlantsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the active plants by default', () => {
    let rows: ManufacturingPlant[] | undefined;
    service.list().subscribe((r) => (rows = r));
    const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/plants'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('include_inactive')).toBeFalse();
    req.flush({ success: true, data: [plant] });
    expect(rows).toEqual([plant]);
  });

  it('adds the inactive plants when asked', () => {
    service.list(true).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/plants'));
    expect(req.request.params.get('include_inactive')).toBe('true');
    req.flush({ success: true, data: [] });
  });

  it('creates a plant with POST', () => {
    const dto = { name: 'Camisas', input_location_id: 11, output_location_id: 12, manager_user_id: null };
    service.create(dto).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/plants'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ success: true, data: { ...plant, id: 2, name: 'Camisas' } });
  });

  it('deactivates a plant with PATCH is_active=false', () => {
    service.update(2, { is_active: false }).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/plants/2'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush({ success: true, data: { ...plant, id: 2, is_active: false } });
  });

  it('returns the API message when deactivation is blocked by open orders', () => {
    let error: unknown;
    service.update(2, { is_active: false }).subscribe({ error: (e) => (error = e) });
    const req = http.expectOne((r) => r.url.endsWith('/store/manufacturing/plants/2'));
    req.flush(
      { message: 'La planta tiene órdenes abiertas', error_code: 'MFG_PLANT_HAS_OPEN_ORDERS' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(typeof error).toBe('string');
    expect(error as string).toContain('órdenes abiertas');
  });
});
