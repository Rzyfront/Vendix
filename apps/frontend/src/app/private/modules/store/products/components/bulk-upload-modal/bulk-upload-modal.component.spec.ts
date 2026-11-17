import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, defer, map, of, throwError, timer } from 'rxjs';

import { BulkUploadModalComponent } from './bulk-upload-modal.component';
import { ProductsService } from '../../services/products.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import { ToastService } from '../../../../../../shared/components';
import type {
  BulkProductAnalysisResult,
  BulkProductUploadPage,
} from '../../interfaces/bulk-product-analysis.interface';

/**
 * QUI-1009 — el commit por lotes se reintenta solo ante red/5xx (el backend es
 * idempotente por SKU), nunca ante un rechazo de datos, y muestra cronómetro,
 * estimado por ritmo real y «lote x/y».
 */
describe('BulkUploadModalComponent — progreso y reintentos (QUI-1009)', () => {
  const TOTAL = 250; // 3 lotes de 100
  let fixture: ComponentFixture<BulkUploadModalComponent>;
  let component: BulkUploadModalComponent;
  let calls: Record<number, number>;
  let respond: (offset: number, attempt: number) => Observable<BulkProductUploadPage>;
  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);

  function page(offset: number): BulkProductUploadPage {
    const rows = Math.min(100, TOTAL - offset);
    return {
      success: true,
      total: TOTAL,
      offset,
      limit: 100,
      done: offset + 100 >= TOTAL,
      total_processed: rows,
      successful: rows,
      failed: 0,
      skipped: 0,
      results: Array.from({ length: rows }, (_, i) => ({
        row_number: offset + i + 2,
        product: null,
        status: 'success' as const,
        message: 'Producto creado exitosamente',
      })),
    };
  }

  const http = (status: number, error: unknown = null) =>
    new HttpErrorResponse({ status, error, url: '/api/store/products/bulk/upload-session' });

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    calls = {};
    respond = (offset) => of(page(offset));
    toast.success.calls.reset();
    toast.warning.calls.reset();
    toast.error.calls.reset();

    await TestBed.configureTestingModule({
      imports: [BulkUploadModalComponent],
      providers: [
        {
          provide: ProductsService,
          useValue: {
            // Fuente fría como HttpClient: cada suscripción es un envío nuevo.
            uploadProductsFromSessionPage: (_s: string, offset: number) =>
              defer(() => {
                calls[offset] = (calls[offset] ?? 0) + 1;
                return respond(offset, calls[offset]);
              }),
            cancelBulkProductSession: () => of(null),
          },
        },
        {
          provide: BulkUploadLogService,
          useValue: { confirmDuplicate: () => Promise.resolve(true) },
        },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(BulkUploadModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BulkUploadModalComponent);
    component = fixture.componentInstance;
    component.sessionId = 'sess-1';
    component.analysisResult.set({
      session_id: 'sess-1',
      total_products: TOTAL,
      ready: TOTAL,
      with_warnings: 0,
      with_errors: 0,
      products: [],
    } as unknown as BulkProductAnalysisResult);
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('un 5xx en un lote se reintenta solo, avisa «reintentando (n/3)» y la carga continúa', async () => {
    respond = (offset, attempt) =>
      offset === 100 && attempt === 1 ? throwError(() => http(502)) : of(page(offset));

    await component.proceedWithUpload();

    expect(calls[100]).toBe(1);
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (1/3)…');
    expect(component.progress().doneBatches).toBe(1);
    expect(component.clock.currentBatch()).toBe(2);
    expect(component.isUploading()).toBeTrue();

    jasmine.clock().tick(1_000);

    expect(calls).toEqual({ 0: 1, 100: 2, 200: 1 });
    expect(component.retryNotice()).toBeNull();
    expect(component.isUploading()).toBeFalse();
    expect(component.uploadResults()?.successful).toBe(TOTAL);
    expect(component.uploadResults()?.failed).toBe(0);
    expect(toast.success).toHaveBeenCalled();
  });

  it('un error de datos (4xx) no se reintenta y marca sus filas con el motivo del backend', async () => {
    respond = (offset) =>
      offset === 100
        ? throwError(() => http(400, { message: 'El offset (100) está fuera del archivo' }))
        : of(page(offset));

    await component.proceedWithUpload();
    jasmine.clock().tick(30_000);

    expect(calls).toEqual({ 0: 1, 100: 1, 200: 1 });
    const results = component.uploadResults()!;
    expect(results.failed).toBe(100);
    expect(results.successful).toBe(150);
    const failedRow = results.results.find((r) => r.status === 'error')!;
    expect(failedRow.message).toBe(
      'Lote de filas 102-201 falló: El offset (100) está fuera del archivo',
    );
    expect(failedRow.message).not.toContain('problema técnico');
    expect(component.retryNotice()).toBeNull();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('agotados los 3 reintentos, el lote queda como problema técnico y la carga sigue', async () => {
    respond = (offset) => (offset === 0 ? throwError(() => http(503)) : of(page(offset)));

    await component.proceedWithUpload();
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (1/3)…');
    jasmine.clock().tick(1_000);
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (2/3)…');
    jasmine.clock().tick(2_000);
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (3/3)…');
    jasmine.clock().tick(4_000);

    expect(calls).toEqual({ 0: 4, 100: 1, 200: 1 });
    const results = component.uploadResults()!;
    expect(results.failed).toBe(100);
    expect(results.successful).toBe(150);
    expect(results.results[0].message).toContain(
      'problema técnico de la plataforma (HTTP 503) tras 3 reintentos',
    );
    expect(results.results[0].message).toContain('No es un error de tu archivo');
    expect(component.retryNotice()).toBeNull();
  });

  it('si el reintento choca con un rechazo, avisa que el intento anterior pudo aplicarse', async () => {
    respond = (offset, attempt) => {
      if (offset !== 200) return of(page(offset));
      return attempt === 1
        ? throwError(() => http(504))
        : throwError(() => http(410, { message: 'La sesión de carga expiró' }));
    };

    await component.proceedWithUpload();
    jasmine.clock().tick(1_000);

    expect(calls[200]).toBe(2);
    const failed = component.uploadResults()!.results.filter((r) => r.status === 'error');
    expect(failed.length).toBe(50);
    expect(failed[0].message).toContain('La sesión de carga expiró');
    expect(failed[0].message).toContain('pudo haberse aplicado');
  });

  it('el cronómetro y el estimado se actualizan con el ritmo real de los lotes', async () => {
    // Cada lote tarda 2 s en responder.
    respond = (offset) => timer(2_000).pipe(map(() => page(offset)));

    await component.proceedWithUpload();
    expect(component.clock.elapsedLabel()).toBe('0 s');
    expect(component.clock.remainingLabel()).toBeNull();
    expect(component.clock.currentBatch()).toBe(1);
    expect(component.clock.totalBatches()).toBe(3);

    jasmine.clock().tick(2_000);
    expect(component.clock.currentBatch()).toBe(2);
    expect(component.clock.elapsedLabel()).toBe('2 s');
    expect(component.clock.remainingMs()).toBe(4_000);

    jasmine.clock().tick(1_000);
    expect(component.clock.elapsedLabel()).toBe('3 s');
    expect(component.clock.remainingMs()).toBe(3_000);

    jasmine.clock().tick(3_000);
    expect(component.isUploading()).toBeFalse();
    expect(component.clock.running()).toBeFalse();
    expect(component.clock.elapsedMs()).toBe(6_000);
    jasmine.clock().tick(5_000);
    expect(component.clock.elapsedMs()).toBe(6_000);
  });
});
