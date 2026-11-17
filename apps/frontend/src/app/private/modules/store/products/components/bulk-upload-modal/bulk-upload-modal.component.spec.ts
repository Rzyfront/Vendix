import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';

import { BulkUploadModalComponent } from './bulk-upload-modal.component';
import { ProductsService } from '../../services/products.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import { BulkUploadJobService } from '../../../bulk-uploads/services/bulk-upload-job.service';
import type { BulkUploadJobView } from '../../../bulk-uploads/bulk-upload-log.interface';
import { ToastService } from '../../../../../../shared/components';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import type { BulkProductAnalysisResult } from '../../interfaces/bulk-product-analysis.interface';

/**
 * QUI-1009 — la carga de productos corre como trabajo de servidor: el modal
 * encola, sigue el avance, lo retoma al reabrir y explica el fallo técnico o
 * de datos.
 */
describe('BulkUploadModalComponent — carga durable (QUI-1009)', () => {
  const INTRO_KEY = 'vendix_bulk_product_intro_dismissed';
  let fixture: ComponentFixture<BulkUploadModalComponent>;
  let component: BulkUploadModalComponent;

  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);
  const jobs = jasmine.createSpyObj<BulkUploadJobService>('BulkUploadJobService', [
    'enqueue',
    'findResumable',
    'watch',
    'getResults',
    'retry',
    'get',
    'forget',
  ]);
  const products = jasmine.createSpyObj<ProductsService>('ProductsService', [
    'analyzeBulkProducts',
    'cancelBulkProductSession',
    'getBulkUploadTemplate',
  ]);

  function view(overrides: Partial<BulkUploadJobView> = {}): BulkUploadJobView {
    return {
      id: 7,
      upload_type: 'products',
      status: 'running',
      file_name: 'productos.csv',
      user_id: 1,
      total_rows: 500,
      processed_rows: 200,
      successful_rows: 200,
      failed_rows: 0,
      skipped_rows: 0,
      created_rows: 200,
      batch_current: 2,
      batch_total: 5,
      retry: null,
      error: null,
      incident_ticket_number: null,
      can_retry: false,
      auto_retry: true,
      created_at: '2026-11-17T09:50:00Z',
      started_at: '2026-11-17T09:51:00Z',
      finished_at: null,
      deadline_at: null,
      ...overrides,
    };
  }

  const text = () =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  function open() {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const analysis = {
    session_id: 'sess-1',
    file_name: 'productos.csv',
    file_hash: 'hash-abc',
    total_products: 3,
    ready: 3,
    with_warnings: 0,
    with_errors: 0,
    products: [],
    initial_load: { rows_with_quantity: 3, total_units: 9, requires_ack: true },
  } as unknown as BulkProductAnalysisResult;

  /** Sube un archivo y llega al paso de revisión con el análisis listo. */
  function analyze() {
    products.analyzeBulkProducts.and.returnValue(of(analysis));
    component.selectedFile.set(new File(['x'], 'productos.csv'));
    component.analyzeFile();
    component.initialLoadAck.set(true);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    localStorage.setItem(INTRO_KEY, 'true');
    [toast.success, toast.warning, toast.error].forEach((s) => s.calls.reset());
    Object.values(jobs).forEach((s) => (s as jasmine.Spy).calls.reset());
    jobs.findResumable.and.returnValue(of(null));
    jobs.watch.and.returnValue(NEVER);
    jobs.getResults.and.returnValue(of([]));
    products.cancelBulkProductSession.calls.reset();
    products.cancelBulkProductSession.and.returnValue(of<void>(undefined));

    await TestBed.configureTestingModule({
      imports: [BulkUploadModalComponent],
      providers: [
        provideRouter([]),
        { provide: ProductsService, useValue: products },
        { provide: BulkUploadJobService, useValue: jobs },
        {
          provide: BulkUploadLogService,
          useValue: { confirmDuplicate: () => Promise.resolve(true) },
        },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BulkUploadModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.removeItem(INTRO_KEY);
    jasmine.clock().uninstall();
  });

  it('al reabrir con una carga corriendo en el servidor muestra su avance sin encolar otra', () => {
    jobs.findResumable.and.returnValue(of(view()));

    open();

    expect(jobs.findResumable).toHaveBeenCalledOnceWith('products');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(jobs.watch).toHaveBeenCalledWith(7, jasmine.any(Function));
    expect(component.currentStep()).toBe(2);
    expect(text()).toContain('Procesando lote 3/5 (200/500)');
    expect(text()).toContain('40%');
    expect(text()).toContain(
      'La carga sigue en el servidor; puedes cerrar esta ventana y volver luego.',
    );
    expect(text()).not.toContain('Buscando cargas en curso');
  });

  it('una carga en cola se muestra como «En cola…»', () => {
    jobs.findResumable.and.returnValue(
      of(view({ status: 'queued', processed_rows: 0, batch_current: 0, started_at: null })),
    );

    open();

    expect(text()).toContain('En cola…');
    expect(text()).not.toContain('Procesando lote');
  });

  it('Cargar encola con sesión, confirmación y archivo; al terminar muestra las filas y avisa', async () => {
    const completed = view({
      status: 'completed',
      total_rows: 3,
      processed_rows: 3,
      successful_rows: 3,
      batch_current: 1,
      batch_total: 1,
      finished_at: '2026-11-17T10:00:05Z',
    });
    jobs.enqueue.and.returnValue(of(view({ status: 'queued', processed_rows: 0 })));
    jobs.watch.and.callFake((_id, onProgress) => {
      onProgress(view({ total_rows: 3, processed_rows: 1, batch_current: 0, batch_total: 1 }));
      onProgress(completed);
      return of(completed);
    });
    jobs.getResults.and.returnValue(
      of([
        {
          row_number: 2,
          status: 'success',
          product_name: 'Camiseta Básica',
          sku: 'CAM-001',
          message: 'Producto creado exitosamente',
        },
        {
          row_number: 3,
          status: 'error',
          product_name: 'Gorra',
          sku: 'GOR-001',
          message: 'Precio inválido',
        },
      ]),
    );
    const emitted = jasmine.createSpy('uploadComplete');
    component.uploadComplete.subscribe(emitted);
    open();
    analyze();

    await component.proceedWithUpload();
    fixture.detectChanges();

    expect(jobs.enqueue).toHaveBeenCalledOnceWith('products', {
      session_id: 'sess-1',
      initial_load_ack: true,
      file_name: 'productos.csv',
      file_hash: 'hash-abc',
    });
    expect(jobs.getResults).toHaveBeenCalledOnceWith(7);
    expect(component.currentStep()).toBe(2);
    expect(text()).toContain('Resumen de Carga');
    expect(text()).toContain('Camiseta Básica');
    expect(text()).toContain('CAM-001');
    expect(text()).toContain('Precio inválido');
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalled();
    expect(component.clock.running()).toBeFalse();
  });

  it('un fallo técnico que el servidor reintenta solo muestra «reintentando (1/3)»', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          retry: {
            attempt: 1,
            max_attempts: 3,
            next_retry_at: '2026-11-17T10:00:02Z',
            message: 'timeout',
          },
        }),
      ),
    );

    open();

    expect(text()).toContain('Problema técnico, reintentando (1/3)…');
  });

  it('failed técnico explica que la carga no se perdió, muestra el ticket y «Reanudar carga» la retoma', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          error: { kind: 'technical', code: 'BULK_JOB_TIMEOUT', message: 'tiempo agotado' },
          incident_ticket_number: 'INC-20261117-AB12CD',
          can_retry: true,
          finished_at: '2026-11-17T10:00:00Z',
        }),
      ),
    );
    jobs.retry.and.returnValue(of(view({ status: 'queued', processed_rows: 200 })));

    open();

    expect(text()).toContain('tu carga no se perdió');
    expect(text()).toContain('Ticket INC-20261117-AB12CD');
    expect(text()).toContain('200 exitosas');
    expect(text()).not.toContain('Corrige tu archivo');
    const resume = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes('Reanudar carga'));
    expect(resume).toBeDefined();

    resume!.click();
    fixture.detectChanges();

    expect(jobs.retry).toHaveBeenCalledOnceWith(7);
    expect(jobs.watch).toHaveBeenCalledWith(7, jasmine.any(Function));
    expect(text()).toContain('En cola…');
    expect(text()).not.toContain('tu carga no se perdió');
  });

  it('failed técnico recordado: «Subir otro archivo» lo olvida y vuelve al inicio sin cerrar el modal', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          error: { kind: 'technical', code: 'BULK_JOB_TIMEOUT', message: 'tiempo agotado' },
          can_retry: true,
          finished_at: '2026-11-17T10:00:00Z',
        }),
      ),
    );
    const closed = spyOn(component.isOpenChange, 'emit');
    open();

    const discard = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes('Subir otro archivo'));
    expect(discard).toBeDefined();

    discard!.click();
    fixture.detectChanges();

    expect(jobs.forget).toHaveBeenCalledOnceWith('products');
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
    expect(component.currentStep()).toBe(0);
    expect(closed).not.toHaveBeenCalled();
    expect(text()).not.toContain('tu carga no se perdió');
  });

  it('failed de datos pide corregir el archivo y no ofrece reanudar', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          error: {
            kind: 'data',
            code: 'BULK_SESSION_EXPIRED',
            message: 'La sesión de carga expiró',
          },
          can_retry: false,
          finished_at: '2026-11-17T10:00:00Z',
        }),
      ),
    );

    open();

    expect(text()).toContain('Corrige tu archivo: La sesión de carga expiró');
    expect(text()).not.toContain('tu carga no se perdió');
    expect(text()).not.toContain('Reanudar carga');
  });

  it('409 BULK_JOB_ALREADY_ACTIVE carga el trabajo activo en vez de mostrar un error', async () => {
    jobs.enqueue.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error_code: 'BULK_JOB_ALREADY_ACTIVE', details: { job_id: 7 } },
          }),
      ),
    );
    jobs.get.and.returnValue(of(view()));
    open();
    analyze();

    await component.proceedWithUpload();
    fixture.detectChanges();

    expect(jobs.get).toHaveBeenCalledOnceWith(7);
    expect(jobs.watch).toHaveBeenCalledWith(7, jasmine.any(Function));
    expect(toast.warning).toHaveBeenCalledWith('Ya hay una carga de productos en curso');
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.currentStep()).toBe(2);
    expect(component.uploadError()).toBeNull();
    expect(text()).toContain('Ya hay una carga de productos en curso');
    expect(text()).toContain('Procesando lote 3/5 (200/500)');
  });

  it('otro error al encolar muestra su mensaje y se queda en la revisión', async () => {
    const error = new HttpErrorResponse({
      status: 503,
      error: { error_code: 'BULK_JOB_ENQUEUE_FAILED', message: 'cola caída' },
    });
    jobs.enqueue.and.returnValue(throwError(() => error));
    open();
    analyze();

    await component.proceedWithUpload();
    fixture.detectChanges();

    expect(component.currentStep()).toBe(1);
    expect(component.uploadError()).toBe(parseApiError(error).userMessage);
    expect(toast.error).toHaveBeenCalledWith(parseApiError(error).userMessage);
    expect(text()).toContain(parseApiError(error).userMessage);
    expect(jobs.watch).not.toHaveBeenCalled();
  });

  it('cerrar con la carga corriendo solo deja de mirar: no cancela la sesión ni olvida el trabajo', () => {
    jobs.findResumable.and.returnValue(of(view()));
    const closed = jasmine.createSpy('isOpenChange');
    component.isOpenChange.subscribe(closed);
    open();

    component.onCancel();

    expect(closed).toHaveBeenCalledOnceWith(false);
    expect(jobs.forget).not.toHaveBeenCalled();
    expect(products.cancelBulkProductSession).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
  });

  it('cerrar tras un resultado terminado olvida el trabajo recordado', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'completed',
          processed_rows: 500,
          successful_rows: 500,
          finished_at: '2026-11-17T10:00:00Z',
        }),
      ),
    );
    open();

    component.onCancel();

    expect(jobs.forget).toHaveBeenCalledOnceWith('products');
  });

  it('cerrar con el encolado en vuelo no cancela la sesión que el trabajo va a usar', async () => {
    jobs.enqueue.and.returnValue(NEVER);
    open();
    analyze();

    await component.proceedWithUpload();
    component.onCancel();

    expect(products.cancelBulkProductSession).not.toHaveBeenCalled();
  });

  it('cerrar tras analizar y antes de cargar sigue cancelando la sesión', () => {
    open();
    analyze();

    component.onCancel();

    expect(products.cancelBulkProductSession).toHaveBeenCalledOnceWith('sess-1');
  });

  it('antes de terminar el primer lote muestra «Preparando el primer lote…», no «0/0»', () => {
    jobs.findResumable.and.returnValue(
      of(view({ status: 'running', batch_current: 0, batch_total: 0, total_rows: 0, processed_rows: 0 })),
    );

    open();

    expect(text()).toContain('Preparando el primer lote…');
    expect(text()).not.toContain('Procesando lote');
  });
});
