import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { StoreUserLookupService, StoreUserOption } from './store-user-lookup.service';
import { environment } from '../../../environments/environment';

/**
 * Regresión «Usuario #id» en el responsable del CRM: `getById` buscaba el id
 * solo en la primera página de usuarios de la tienda (clientes incluidos) y en
 * modo staff ni siquiera llamaba al API. Ahora pide ese id exacto.
 */
describe('StoreUserLookupService · getById', () => {
  let service: StoreUserLookupService;
  let httpMock: HttpTestingController;
  const usersUrl = `${environment.apiUrl}/store/users`;
  const staffUrl = `${environment.apiUrl}/store/users/staff-lookup`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StoreUserLookupService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('modo staff: consulta staff-lookup por ese id y devuelve el nombre', () => {
    let result: StoreUserOption | null | undefined;
    service.getById(42, { mode: 'staff' }).subscribe((user) => (result = user));

    const req = httpMock.expectOne(
      (r) => r.url === staffUrl && r.params.get('ids') === '42',
    );
    req.flush({ data: [{ id: 42, first_name: 'Sara', last_name: 'Vélez' }] });

    expect(result).toEqual(
      jasmine.objectContaining({ id: 42, name: 'Sara Vélez' }),
    );
  });

  it('modo por defecto: consulta /store/users por ese id, sin depender de la primera página', () => {
    let result: StoreUserOption | null | undefined;
    service.getById(1500).subscribe((user) => (result = user));

    const req = httpMock.expectOne(
      (r) => r.url === usersUrl && r.params.get('ids') === '1500',
    );
    expect(req.request.params.has('state')).toBeFalse();
    req.flush({ data: [{ id: 1500, first_name: 'Leo', email: 'leo@vendix.test' }] });

    expect(result?.name).toBe('Leo');
  });

  it('comparte la respuesta entre selectores: un solo request por persona', () => {
    const names: string[] = [];
    service.getById(42, { mode: 'staff' }).subscribe((u) => names.push(u!.name));
    service.getById(42, { mode: 'staff' }).subscribe((u) => names.push(u!.name));

    httpMock
      .expectOne((r) => r.url === staffUrl)
      .flush({ data: [{ id: 42, first_name: 'Sara', last_name: null }] });
    service.getById(42, { mode: 'staff' }).subscribe((u) => names.push(u!.name));

    expect(names).toEqual(['Sara', 'Sara', 'Sara']);
  });

  it('si no lo encuentra devuelve null y no lo deja en caché', () => {
    let result: StoreUserOption | null | undefined;
    service.getById(7, { mode: 'staff' }).subscribe((user) => (result = user));
    httpMock.expectOne((r) => r.url === staffUrl).flush({ data: [] });
    expect(result).toBeNull();

    service.getById(7, { mode: 'staff' }).subscribe();
    httpMock
      .expectOne((r) => r.url === staffUrl)
      .flush({ data: [{ id: 7, first_name: 'Nuevo', last_name: null }] });
  });
});
