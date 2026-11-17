import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';

import { BulkAdjustmentModalComponent } from './bulk-adjustment-modal.component';
import { InventoryService } from '../../services';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import { BulkUploadJobService } from '../../../bulk-uploads/services/bulk-upload-job.service';
import { BulkUploadJobView } from '../../../bulk-uploads/bulk-upload-log.interface';
import { ToastService } from '../../../../../../shared/components/index';

/**
 * QUI-1009 — el ajuste masivo de inventario corre como trabajo del servidor: el
 * modal encola, sigue el avance, retoma la carga al reabrirse y distingue un
 * fallo técnico (reanudable) de un error de datos.
 */
describe('BulkAdjustmentModalComponent — trabajo durable (QUI-1009)', () => {
  let fixture: ComponentFixture<BulkAdjustmentModalComponent>;
  let component: BulkAdjustmentModalComponent;

  const jobs = jasmine.createSpyObj<BulkUploadJobService>('BulkUploadJobService', [
    'enqueue',
    'get',
    'getResults',
    'retry',
    'watch',
    'findResumable',
    'forget',
  ]);
  const inventory = jasmine.createSpyObj<InventoryService>('InventoryService', [
    'analyzeBulkAdjustments',
    'cancelBulkAdjustmentSession',
  ]);
  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);

  function makeView(over: Partial<BulkUploadJobView>): BulkUploadJobView {
    return {
      id: 52,
      upload_type: 'inventory_adjustments',
      status: 'queued',
      file_name: 'ajustes.xlsx',
      user_id: 1,
      total_rows: 500,
      processed_rows: 0,
      successful_rows: 0,
      failed_rows: 0,
      skipped_rows: 0,
      created_rows: null,
      batch_current: 0,
      batch_total: 5,
      retry: null,
      error: null,
      incident_ticket_number: null,
      can_retry: false,
      auto_retry: true,
      created_at: '2026-11-17T09:59:00Z',
      started_at: '2026-11-17T09:59:10Z',
      finished_at: null,
      deadline_at: null,
      ...over,
    };
  }

  function openModal(): void {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    [jobs.enqueue, jobs.get, jobs.getResults, jobs.retry, jobs.watch, jobs.findResumable, jobs.forget].forEach(
      (spy) => spy.calls.reset(),
    );
    toast.success.calls.reset();
    toast.warning.calls.reset();
    jobs.findResumable.and.returnValue(of(null));
    jobs.getResults.and.returnValue(of([]));
    jobs.watch.and.returnValue(NEVER);
    inventory.analyzeBulkAdjustments.and.returnValue(
      of({
        success: true,
        message: 'ok',
        data: {
          session_id: 'sess-1',
          file_name: 'ajustes.xlsx',
          file_hash: 'hash-1',
          duplicate_of: null,
          total: 2,
          valid: 2,
          failed: 0,
          errors: [],
          requires_initial_load_ack: true,
        },
      }),
    );
    inventory.cancelBulkAdjustmentSession.and.returnValue(
      of({ success: true, message: 'ok', data: null }),
    );

    await TestBed.configureTestingModule({
      imports: [BulkAdjustmentModalComponent],
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: BulkUploadJobService, useValue: jobs },
        {
          provide: BulkUploadLogService,
          useValue: { confirmDuplicate: () => Promise.resolve(true) },
        },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(BulkAdjustmentModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BulkAdjustmentModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  async function analyzeAndUpload(): Promise<void> {
    component.selectedLocationId.set('7');
    component.selectedAdjustmentType.set('manual_correction');
    component.description.set('Conteo de noviembre');
    component.selectedFile.set(new File(['x'], 'ajustes.xlsx'));
    component.analyzeFile();
    component.initialLoadAck.set(true);
    await component.confirmUpload();
  }

  it('al reabrir con un trabajo en curso muestra «Procesando lote 3/5 (200/500)» sin encolar de nuevo', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'running',
          batch_current: 2,
          batch_total: 5,
          processed_rows: 200,
          total_rows: 500,
        }),
      ),
    );

    openModal();

    expect(jobs.findResumable).toHaveBeenCalledWith('inventory_adjustments');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(jobs.watch).toHaveBeenCalledWith(52, jasmine.any(Function));
    expect(component.step()).toBe(4);
    expect(component.isResuming()).toBeFalse();
    expect(component.progressLabel()).toBe('Procesando lote 3/5 (200/500)');
    expect(component.progressPercent()).toBe(40);
  });

  it('muestra «En cola…» y el aviso de reintento técnico del servidor', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'running',
          retry: { attempt: 2, max_attempts: 3, next_retry_at: '2026-11-17T10:00:04Z', message: 'x' },
        }),
      ),
    );
    openModal();
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (2/3)…');

    component.job.set(makeView({ status: 'queued' }));
    expect(component.progressLabel()).toBe('En cola…');
  });

  it('Aplicar encola con el cuerpo exacto y un trabajo completed muestra las filas y avisa a la pantalla', async () => {
    const done = makeView({
      status: 'completed',
      processed_rows: 2,
      total_rows: 2,
      successful_rows: 2,
      batch_current: 1,
      batch_total: 1,
      finished_at: '2026-11-17T10:00:05Z',
    });
    jobs.enqueue.and.returnValue(of(makeView({ status: 'queued' })));
    jobs.watch.and.callFake((_id: number, onProgress: (v: BulkUploadJobView) => void) => {
      onProgress(done);
      return of(done);
    });
    jobs.getResults.and.returnValue(
      of([
        { row_number: 2, status: 'success', sku: 'A-1', product_name: 'Camisa', quantity_before: 3, quantity_after: 5, quantity_change: 2 },
        { row_number: 3, status: 'success', sku: 'B-1', product_name: 'Pantalón', quantity_before: 9, quantity_after: 4, quantity_change: -5 },
      ]),
    );
    let emitted = 0;
    component.completed.subscribe(() => emitted++);

    await analyzeAndUpload();

    expect(jobs.enqueue).toHaveBeenCalledOnceWith('inventory_adjustments', {
      session_id: 'sess-1',
      location_id: 7,
      adjustment_type: 'manual_correction',
      description: 'Conteo de noviembre',
      initial_load_ack: true,
      file_name: 'ajustes.xlsx',
      file_hash: 'hash-1',
    });
    expect(jobs.getResults).toHaveBeenCalledWith(52);
    expect(component.isUploading()).toBeFalse();
    expect(component.uploadResult()?.successful).toBe(2);
    expect(component.uploadResult()?.results.length).toBe(2);
    expect(component.uploadResult()?.results[1].quantity_change).toBe(-5);
    expect(emitted).toBe(1);
  });

  it('un 409 BULK_JOB_ALREADY_ACTIVE avisa y carga el trabajo activo', async () => {
    jobs.enqueue.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          error_code: 'BULK_JOB_ALREADY_ACTIVE',
          message: 'Ya hay una carga activa',
          details: { job_id: 88 },
        },
      })),
    );
    jobs.get.and.returnValue(of(makeView({ id: 88, status: 'running', batch_current: 1 })));

    await analyzeAndUpload();

    expect(toast.warning).toHaveBeenCalledWith('Ya hay una carga de ajustes de inventario en curso');
    expect(jobs.get).toHaveBeenCalledWith(88);
    expect(jobs.watch).toHaveBeenCalledWith(88, jasmine.any(Function));
    expect(component.step()).toBe(4);
  });

  it('failed técnico: «tu carga no se perdió», ticket y Reanudar carga', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'failed',
          processed_rows: 200,
          error: { kind: 'technical', code: 'BULK_JOB_TIMEOUT', message: 'Tiempo agotado' },
          incident_ticket_number: 'INC-20261117-XYZ789',
          can_retry: true,
        }),
      ),
    );
    jobs.retry.and.returnValue(of(makeView({ status: 'queued' })));

    openModal();

    expect(component.technicalFailure()).toBeTrue();
    expect(component.dataFailure()).toBeFalse();
    expect(component.job()?.incident_ticket_number).toBe('INC-20261117-XYZ789');
    expect(jobs.getResults).toHaveBeenCalledWith(52);
    expect(jobs.watch).not.toHaveBeenCalled();

    component.retryJob();

    expect(jobs.retry).toHaveBeenCalledWith(52);
    expect(jobs.watch).toHaveBeenCalledWith(52, jasmine.any(Function));
  });

  it('failed técnico recordado: «Subir otro archivo» lo olvida y vuelve al inicio sin cerrar el modal', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'failed',
          processed_rows: 200,
          error: { kind: 'technical', code: 'BULK_JOB_TIMEOUT', message: 'Tiempo agotado' },
          can_retry: true,
        }),
      ),
    );
    const closed = spyOn(component.isOpenChange, 'emit');
    openModal();
    fixture.detectChanges();

    // La plantilla está vacía en este spec: se prueba el manejador del botón.
    component.discardJob();
    fixture.detectChanges();

    expect(jobs.forget).toHaveBeenCalledOnceWith('inventory_adjustments');
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
    expect(component.technicalFailure()).toBeFalse();
    expect(component.step()).toBe(1);
    expect(closed).not.toHaveBeenCalled();
  });

  it('failed de datos: «Corrige tu archivo» con el motivo y sin reanudar', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'failed',
          error: { kind: 'data', code: 'INV_BULK_SESSION_EXPIRED', message: 'La sesión venció' },
        }),
      ),
    );

    openModal();

    expect(component.dataFailure()).toBeTrue();
    expect(component.technicalFailure()).toBeFalse();
    expect(component.job()?.error?.message).toBe('La sesión venció');
    component.retryJob();
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('cerrar con un trabajo en curso solo deja de seguirlo; cerrar tras un resultado lo olvida', () => {
    jobs.findResumable.and.returnValue(of(makeView({ status: 'running' })));
    openModal();

    component.onClose();
    expect(jobs.forget).not.toHaveBeenCalled();
    expect(inventory.cancelBulkAdjustmentSession).not.toHaveBeenCalled();

    jobs.findResumable.and.returnValue(of(makeView({ status: 'completed', successful_rows: 1 })));
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    openModal();
    component.onClose();
    expect(jobs.forget).toHaveBeenCalledWith('inventory_adjustments');
  });
});
