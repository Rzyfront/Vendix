import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DianMunicipalityLookupService } from './dian-municipality-lookup.service';

describe('DianMunicipalityLookupService catálogo', () => {
  let service: DianMunicipalityLookupService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DianMunicipalityLookupService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('obtiene y cachea una sola lista de 33 departamentos', () => {
    const first = service.listDepartments();
    const second = service.listDepartments();
    first.subscribe();
    second.subscribe();

    const request = httpMock.expectOne((req) => req.url.endsWith('/departments'));
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: Array.from({ length: 33 }, (_, i) => ({ code: `${i}`, name: `Depto ${i}` })) });
  });

  it('obtiene todos los municipios del departamento sin limit y comparte la request', () => {
    const first = service.listByDepartment('05');
    const second = service.listByDepartment('05');
    first.subscribe();
    second.subscribe();

    const request = httpMock.expectOne((req) => req.url.endsWith('/municipalities'));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('department_code')).toBe('05');
    expect(request.request.params.has('limit')).toBeFalse();
    request.flush({ data: Array.from({ length: 125 }, (_, i) => ({
      code: `050${String(i).padStart(2, '0')}`,
      name: `Municipio ${i}`,
      department_code: '05',
      department_name: 'Antioquia',
      postal_code: '',
    })), meta: { total: 125 } });
  });

  it('separa los caches por URL efectiva y resuelve códigos dentro de esa URL', () => {
    service.setBaseUrl('/api/store/addresses/dian/municipalities');
    service.listDepartments().subscribe();
    httpMock.expectOne('/api/store/addresses/dian/departments').flush({ data: [{ code: '05', name: 'Antioquia' }] });
    service.listByDepartment('05').subscribe();
    httpMock.expectOne((req) => req.url === '/api/store/addresses/dian/municipalities' && req.params.get('department_code') === '05')
      .flush({ data: [{ code: '05001', name: 'Medellín', department_code: '05', department_name: 'Antioquia', postal_code: '' }] });

    service.setBaseUrl('/api/superadmin/addresses/dian/municipalities');
    service.listDepartments().subscribe();
    httpMock.expectOne('/api/superadmin/addresses/dian/departments').flush({ data: [{ code: '05', name: 'Antioquia' }] });
    service.listByDepartment('05').subscribe();
    httpMock.expectOne((req) => req.url === '/api/superadmin/addresses/dian/municipalities' && req.params.get('department_code') === '05')
      .flush({ data: [{ code: '05001', name: 'Medellín superadmin', department_code: '05', department_name: 'Antioquia', postal_code: '' }] });

    let resolved = false;
    service.resolveByCode('05001').subscribe((value) => { resolved = value?.name === 'Medellín superadmin'; });
    expect(resolved).toBeTrue();
    httpMock.expectNone((req) => req.url.endsWith('/resolve'));

    service.setBaseUrl('/api/store/addresses/dian/municipalities');
    let storeResolved = false;
    service.resolveByCode('05001').subscribe((value) => { storeResolved = value?.name === 'Medellín'; });
    expect(storeResolved).toBeTrue();
    httpMock.expectNone((req) => req.url.endsWith('/resolve'));
  });

  it('vuelve a intentar un catálogo después de error HTTP', () => {
    let sawError = false;
    service.listDepartments().subscribe({ error: () => { sawError = true; } });
    httpMock.expectOne((req) => req.url.endsWith('/departments')).flush('unavailable', { status: 503, statusText: 'Unavailable' });
    expect(sawError).toBeTrue();

    let departments: unknown;
    service.listDepartments().subscribe((value) => { departments = value; });
    httpMock.expectOne((req) => req.url.endsWith('/departments')).flush({ data: [{ code: '44', name: 'La Guajira' }] });
    expect(departments).toEqual([{ code: '44', name: 'La Guajira' }]);
  });
});
