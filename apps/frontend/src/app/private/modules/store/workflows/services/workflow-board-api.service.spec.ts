import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowBoardApiService } from './workflow-board-api.service';

describe('WorkflowBoardApiService', () => {
  let api: WorkflowBoardApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkflowBoardApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pide el tablero con solo los filtros definidos y devuelve data', () => {
    let keys: string[] = [];
    api
      .getBoard({ role_id: 2, location_id: 1, overdue: true, definition_id: undefined })
      .subscribe((d) => (keys = d.columns.map((c) => c.key)));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/board'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('role_id')).toBe('2');
    expect(req.request.params.get('location_id')).toBe('1');
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.has('definition_id')).toBeFalse();
    req.flush({ data: { columns: [{ key: 'pending', name: 'Por atender', count: 0, cards: [], next_cursor: null }] } });
    expect(keys).toEqual(['pending']);
  });

  it('carga filtros y sedes', () => {
    let roles = 0;
    let locations = 0;
    api.getFilters().subscribe((f) => (roles = f.roles.length));
    http
      .expectOne((r) => r.url.endsWith('/board/filters'))
      .flush({ data: { definitions: [], roles: [{ id: 2, name: 'manager' }], locations: [] } });
    api.listLocations().subscribe((l) => (locations = l.length));
    http.expectOne((r) => r.url.endsWith('/board/locations')).flush({ data: [{ id: 1, name: 'Bodega' }] });
    expect(roles).toBe(1);
    expect(locations).toBe(1);
  });
});
