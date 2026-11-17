import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { environment } from '../../../../../../environments/environment';
import { BulkUploadJobView } from '../bulk-upload-log.interface';
import { BulkUploadJobService } from './bulk-upload-job.service';

/** QUI-1009 — cliente del trabajo de carga masiva del servidor. */
describe('BulkUploadJobService (QUI-1009)', () => {
  let service: BulkUploadJobService;
  let http: HttpTestingController;
  const jobsUrl = `${environment.apiUrl}/store/bulk-uploads/jobs`;
  const storageKey = 'vendix:bulk-upload-job:products';

  function view(overrides: Partial<BulkUploadJobView> = {}): BulkUploadJobView {
    return {
      id: 41,
      upload_type: 'products',
      status: 'running',
      file_name: 'catalogo.xlsx',
      user_id: 7,
      total_rows: 300,
      processed_rows: 100,
      successful_rows: 100,
      failed_rows: 0,
      skipped_rows: 0,
      created_rows: null,
      batch_current: 1,
      batch_total: 3,
      retry: null,
      error: null,
      incident_ticket_number: null,
      can_retry: false,
      auto_retry: true,
      created_at: '2026-11-17T10:00:00Z',
      started_at: '2026-11-17T10:00:01Z',
      finished_at: null,
      deadline_at: '2026-11-17T11:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BulkUploadJobService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(storageKey);
  });

  it('encola en la ruta del tipo y recuerda el trabajo en este navegador', () => {
    let result: BulkUploadJobView | undefined;
    service
      .enqueue('products', {
        session_id: 'abc',
        initial_load_ack: true,
        file_name: 'catalogo.xlsx',
        file_hash: 'f'.repeat(64),
      })
      .subscribe((v) => (result = v));

    const req = http.expectOne(`${environment.apiUrl}/store/products/bulk/jobs`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      session_id: 'abc',
      initial_load_ack: true,
      file_name: 'catalogo.xlsx',
      file_hash: 'f'.repeat(64),
    });
    req.flush({ success: true, data: view({ status: 'queued' }) });

    expect(result?.id).toBe(41);
    expect(localStorage.getItem(storageKey)).toBe('41');
  });

  it('findResumable devuelve la carga activa de la tienda', () => {
    let result: BulkUploadJobView | null | undefined;
    service.findResumable('products').subscribe((v) => (result = v));

    const req = http.expectOne(`${jobsUrl}/active?upload_type=products`);
    req.flush({ success: true, data: view() });

    expect(result?.status).toBe('running');
  });

  it('sin carga activa, findResumable trae el último trabajo recordado aunque ya terminó', () => {
    service.remember('products', 41);
    let result: BulkUploadJobView | null | undefined;
    service.findResumable('products').subscribe((v) => (result = v));

    http
      .expectOne(`${jobsUrl}/active?upload_type=products`)
      .flush({ success: true, data: null });
    http
      .expectOne(`${jobsUrl}/41`)
      .flush({ success: true, data: view({ status: 'completed' }) });

    expect(result?.status).toBe('completed');
  });

  it('olvida el trabajo recordado que ya no existe (404) y no lanza', () => {
    service.remember('products', 41);
    let result: BulkUploadJobView | null | undefined;
    service.findResumable('products').subscribe((v) => (result = v));

    http
      .expectOne(`${jobsUrl}/active?upload_type=products`)
      .flush({ success: true, data: null });
    http
      .expectOne(`${jobsUrl}/41`)
      .flush({ error_code: 'BULK_JOB_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });

    expect(result).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  describe('watch', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('pinta cada lectura, espera 1 s y 2 s entre consultas y emite UNA vez el estado final', () => {
      const seen: string[] = [];
      let final: BulkUploadJobView | undefined;
      service
        .watch(41, (v) => seen.push(`${v.status}:${v.batch_current}`))
        .subscribe((v) => (final = v));

      http.expectOne(`${jobsUrl}/41`).flush({ success: true, data: view() });
      expect(seen).toEqual(['running:1']);
      expect(final).toBeUndefined();

      jasmine.clock().tick(999);
      http.expectNone(`${jobsUrl}/41`);
      jasmine.clock().tick(1);
      http
        .expectOne(`${jobsUrl}/41`)
        .flush({ success: true, data: view({ batch_current: 2 }) });

      jasmine.clock().tick(2_000);
      http.expectOne(`${jobsUrl}/41`).flush({
        success: true,
        data: view({ status: 'completed', batch_current: 3, processed_rows: 300 }),
      });

      expect(seen).toEqual(['running:1', 'running:2', 'completed:3']);
      expect(final?.status).toBe('completed');
    });

    it('un 503 en una consulta se reintenta sin cortar el seguimiento', () => {
      let final: BulkUploadJobView | undefined;
      let failed = false;
      service.watch(41, () => undefined).subscribe({
        next: (v) => (final = v),
        error: () => (failed = true),
      });

      http
        .expectOne(`${jobsUrl}/41`)
        .flush({}, { status: 503, statusText: 'Service Unavailable' });
      jasmine.clock().tick(1_000);
      http.expectOne(`${jobsUrl}/41`).flush({
        success: true,
        data: view({ status: 'failed', error: { kind: 'technical', code: null, message: 'x' } }),
      });

      expect(failed).toBeFalse();
      expect(final?.status).toBe('failed');
    });

    it('una caída de la API más larga que 3 reintentos tampoco corta el seguimiento', () => {
      let final: BulkUploadJobView | undefined;
      let failed = false;
      service.watch(41, () => undefined).subscribe({
        next: (v) => (final = v),
        error: () => (failed = true),
      });

      const down = () =>
        http
          .expectOne(`${jobsUrl}/41`)
          .flush({}, { status: 503, statusText: 'Service Unavailable' });
      down();
      for (const waitMs of [1_000, 2_000, 4_000, 10_000, 10_000]) {
        jasmine.clock().tick(waitMs);
        down();
      }
      expect(failed).toBeFalse();

      jasmine.clock().tick(10_000);
      http.expectOne(`${jobsUrl}/41`).flush({
        success: true,
        data: view({ status: 'completed', batch_current: 3, processed_rows: 300 }),
      });

      expect(failed).toBeFalse();
      expect(final?.status).toBe('completed');
    });
  });

  describe('mensaje del error', () => {
    it('traduce el mensaje técnico del servidor por su código', () => {
      let result: BulkUploadJobView | undefined;
      service.get(41).subscribe((v) => (result = v));

      http.expectOne(`${jobsUrl}/41`).flush({
        success: true,
        data: view({
          status: 'failed',
          error: {
            kind: 'data',
            code: 'BULK_PROD_SESSION_EXPIRED',
            message: 'Analysis session not found or expired',
          },
        }),
      });

      expect(result?.error).toEqual({
        kind: 'data',
        code: 'BULK_PROD_SESSION_EXPIRED',
        message: 'La sesion de analisis expiro. Suba el archivo nuevamente.',
      });
    });

    it('sin traducción para el código conserva el mensaje del servidor', () => {
      let result: BulkUploadJobView | null | undefined;
      service.getActive('products').subscribe((v) => (result = v));

      http.expectOne(`${jobsUrl}/active?upload_type=products`).flush({
        success: true,
        data: view({
          status: 'failed',
          error: { kind: 'data', code: 'CODIGO_SIN_TRADUCCION', message: 'Fila 3 inválida' },
        }),
      });

      expect(result?.error?.message).toBe('Fila 3 inválida');
    });
  });
});
