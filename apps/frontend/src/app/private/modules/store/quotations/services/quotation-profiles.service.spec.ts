import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { environment } from '../../../../../../environments/environment';
import { QuotationProfilesService } from './quotation-profiles.service';

const API = `${environment.apiUrl}/store/quotation-profiles`;
const row = { id: 8, name: 'Perfil', state: 'active', is_default: false, current_version: 1, current_config: {}, created_at: '2026-01-01', updated_at: '2026-01-01' };

describe('QuotationProfilesService', () => {
  let service: QuotationProfilesService;
  let http: HttpTestingController;
  const store = signal<{ id: number } | null>({ id: 1 });

  beforeEach(() => {
    store.set({ id: 1 });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        QuotationProfilesService,
        { provide: AuthFacade, useValue: { userStore: store } },
      ],
    });
    service = TestBed.inject(QuotationProfilesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads actual paginated response envelopes for profiles and versions', () => {
    let detail: any;
    service.getProfile(8).subscribe((result) => detail = result);
    const detailRequest = http.expectOne(`${API}/8`);
    expect(detailRequest.request.method).toBe('GET');
    detailRequest.flush({ success: true, data: row });
    expect(detail.id).toBe(8);

    let profiles: any;
    service.getProfiles({ page: 3, limit: 20, search: 'obra', state: 'active' }).subscribe((result) => profiles = result);
    const request = http.expectOne(`${API}?page=3&limit=20&search=obra&state=active`);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: [row], meta: { total: 51, page: 3, limit: 20, totalPages: 3 } });
    expect(profiles).toEqual({ data: [row], total: 51, page: 3, limit: 20 });

    let versions: any;
    service.getVersions(8, 2, 10).subscribe((result) => versions = result);
    const history = http.expectOne(`${API}/8/versions?page=2&limit=10`);
    history.flush({ success: true, data: [{ id: 9, version: 2, config: {}, created_at: '2026-01-02' }], meta: { total: 21, page: 2, limit: 10, totalPages: 3 } });
    expect(versions.total).toBe(21);
    expect(versions.page).toBe(2);
    expect(versions.data[0].version).toBe(2);
  });

  it('caches the catalog only within the same known store and resets it after a read error', () => {
    const now = spyOn(Date, 'now').and.returnValue(1_000);
    let received: unknown;
    service.getCatalog().subscribe({ error: (error) => received = error });
    http.expectOne(`${API}/catalog`).flush({ message: 'falló' }, { status: 503, statusText: 'Unavailable' });
    expect(received instanceof Error).toBeTrue();

    let catalog: unknown;
    service.getCatalog().subscribe((result) => catalog = result);
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [{ id: 8, name: 'Perfil', is_default: false, current_version: 1 }] });
    expect(catalog).toEqual([{ id: 8, name: 'Perfil', is_default: false, current_version: 1 }]);
    service.getCatalog().subscribe();
    http.expectNone(`${API}/catalog`);

    now.and.returnValue(32_000);
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    store.set({ id: 2 });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });
    store.set(null);
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });
  });

  it('uses distinct mutation endpoints and invalidates cached catalog after mutations', () => {
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.create({ name: 'Nuevo', config: {} }).subscribe();
    const create = http.expectOne(API);
    expect(create.request.method).toBe('POST');
    create.flush({ success: true, data: row });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.update(8, { name: 'Editado', config: { admin_percent: 0 } }).subscribe();
    const update = http.expectOne(`${API}/8`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ name: 'Editado', config: { admin_percent: 0 } });
    update.flush({ success: true, data: row });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.clone(8, 'Copia').subscribe();
    const clone = http.expectOne(`${API}/8/clone`);
    expect(clone.request.method).toBe('POST');
    expect(clone.request.body).toEqual({ name: 'Copia' });
    clone.flush({ success: true, data: row });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.setDefault(8).subscribe();
    const makeDefault = http.expectOne(`${API}/8/set-default`);
    expect(makeDefault.request.method).toBe('POST');
    makeDefault.flush({ success: true, data: { is_default: true } });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.setActive(8, true).subscribe();
    http.expectOne(`${API}/8/activate`).flush({ success: true, data: row });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });
    service.setActive(8, false).subscribe();
    http.expectOne(`${API}/8/deactivate`).flush({ success: true, data: row });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });

    service.remove(8).subscribe();
    const remove = http.expectOne(`${API}/8`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ success: true, data: { deleted: true, id: 8 } });
    service.getCatalog().subscribe();
    http.expectOne(`${API}/catalog`).flush({ success: true, data: [] });
  });
});
