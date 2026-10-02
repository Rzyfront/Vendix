import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DianMunicipalityLookupService } from './dian-municipality-lookup.service';
import { environment } from '../../../environments/environment';

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
    let firstResult: unknown[] = [];
    let secondResult: unknown[] = [];
    first.subscribe((value) => firstResult = value);
    second.subscribe((value) => secondResult = value);

    const request = httpMock.expectOne((req) => req.url.endsWith('/departments'));
    expect(request.request.method).toBe('GET');
    const departments = Array.from({ length: 33 }, (_, i) => ({ code: `${i}`, name: `Depto ${i}` }));
    request.flush({ success: true, data: departments });
    expect(firstResult.length).toBe(33);
    expect(secondResult).toEqual(departments);

    let cachedCount = 0;
    service.listDepartments().subscribe((value) => cachedCount = value.length);
    expect(cachedCount).toBe(33);
    httpMock.expectNone((req) => req.url.endsWith('/departments'));
  });

  it('obtiene todos los municipios del departamento sin limit y comparte la request', () => {
    const first = service.listByDepartment('05');
    const second = service.listByDepartment('05');
    let firstResult: unknown[] = [];
    let secondResult: unknown[] = [];
    first.subscribe((value) => firstResult = value);
    second.subscribe((value) => secondResult = value);

    const request = httpMock.expectOne((req) => req.url.endsWith('/municipalities'));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('department_code')).toBe('05');
    expect(request.request.params.has('limit')).toBeFalse();
    const municipalities = Array.from({ length: 125 }, (_, i) => ({
      code: `050${String(i).padStart(2, '0')}`,
      name: `Municipio ${i}`,
      department_code: '05',
      department_name: 'Antioquia',
      postal_code: '',
    }));
    request.flush({ data: municipalities, meta: { total: 125 } });
    expect(firstResult.length).toBe(125);
    expect(secondResult).toEqual(municipalities);

    let cachedCount = 0;
    service.listByDepartment('05').subscribe((value) => cachedCount = value.length);
    expect(cachedCount).toBe(125);
    httpMock.expectNone((req) => req.url.endsWith('/municipalities') && req.params.get('department_code') === '05');
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

    service.setBaseUrl('/api/superadmin/addresses/dian/municipalities');
    service.setBaseUrl(null);
    service.listDepartments().subscribe();
    httpMock.expectOne(`${environment.apiUrl}/store/addresses/dian/departments`)
      .flush({ data: [{ code: '05', name: 'Antioquia' }] });
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

    let municipalityError = false;
    service.listByDepartment('44').subscribe({ error: () => { municipalityError = true; } });
    httpMock.expectOne((req) => req.url.endsWith('/municipalities') && req.params.get('department_code') === '44')
      .flush('unavailable', { status: 503, statusText: 'Unavailable' });
    expect(municipalityError).toBeTrue();

    let municipalityCount = 0;
    service.listByDepartment('44').subscribe((value) => municipalityCount = value.length);
    httpMock.expectOne((req) => req.url.endsWith('/municipalities') && req.params.get('department_code') === '44')
      .flush({ data: [{ code: '44001', name: 'Riohacha' }] });
    expect(municipalityCount).toBe(1);
  });
});
