import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { CustomerBulkUploadModalComponent } from './bulk-upload-modal.component';
import { CustomersService } from '../../services/customers.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import { BulkUploadJobService } from '../../../bulk-uploads/services/bulk-upload-job.service';
import {
  BulkUploadJobResultRow,
  BulkUploadJobView,
} from '../../../bulk-uploads/bulk-upload-log.interface';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components';

/**
 * QUI-1009 (T4, S2) — la carga de clientes corre como trabajo del servidor:
 * el modal encola, sigue el avance, se retoma al reabrir y NO reintenta solo
 * (la carga de clientes no es idempotente): «Reintentar lote» es manual.
 */
describe('CustomerBulkUploadModalComponent — carga durable en servidor (QUI-1009)', () => {
  let fixture: ComponentFixture<CustomerBulkUploadModalComponent>;
  let component: CustomerBulkUploadModalComponent;
  let jobs: jasmine.SpyObj<BulkUploadJobService>;
  let log: jasmine.SpyObj<BulkUploadLogService>;
  let dialog: jasmine.SpyObj<DialogService>;
  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);

  const view = (over: Partial<BulkUploadJobView> = {}): BulkUploadJobView => ({
    id: 7,
    upload_type: 'customers',
    status: 'running',
    file_name: 'clientes.xlsx',
    user_id: 1,
    total_rows: 400,
    processed_rows: 0,
    successful_rows: 0,
    failed_rows: 0,
    skipped_rows: 0,
    created_rows: null,
    batch_current: 0,
    batch_total: 4,
    retry: null,
    error: null,
    incident_ticket_number: null,
    can_retry: false,
    auto_retry: false,
    created_at: '2026-11-17T09:59:00Z',
    started_at: '2026-11-17T09:59:30Z',
    finished_at: null,
    deadline_at: null,
    ...over,
  });

  const rows = (n: number): BulkUploadJobResultRow[] =>
    Array.from({ length: n }, (_, i) => ({
      row_number: i + 2,
      status: 'success',
      message: 'Cliente creado exitosamente',
    }));

  const open = () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    toast.success.calls.reset();
    toast.warning.calls.reset();
    toast.error.calls.reset();
    toast.info.calls.reset();

    jobs = jasmine.createSpyObj<BulkUploadJobService>('BulkUploadJobService', [
      'enqueue',
      'get',
      'getResults',
      'retry',
      'watch',
      'findResumable',
      'remember',
      'forget',
    ]);
    jobs.findResumable.and.returnValue(of(null));
    jobs.getResults.and.returnValue(of([]));
    log = jasmine.createSpyObj<BulkUploadLogService>('BulkUploadLogService', [
      'confirmFileIsNew',
      'fingerprint',
      'register',
    ]);
    log.confirmFileIsNew.and.resolveTo(true);
    dialog = jasmine.createSpyObj<DialogService>('DialogService', ['confirm']);
    dialog.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [CustomerBulkUploadModalComponent],
      providers: [
        { provide: CustomersService, useValue: {} },
        { provide: BulkUploadLogService, useValue: log },
        { provide: BulkUploadJobService, useValue: jobs },
        { provide: DialogService, useValue: dialog },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(CustomerBulkUploadModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CustomerBulkUploadModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  const parsed = () =>
    component.parsedData.set([
      { row_number: 2, first_name: 'Ana', email: ' ana@x.co ' },
      { row_number: 3, first_name: 'Luis', email: '  ' },
    ]);

  it('reabrir con un trabajo corriendo abre en el progreso «Procesando lote 2/4 (100/400)» sin encolar', () => {
    const running = view({ batch_current: 1, processed_rows: 100 });
    jobs.findResumable.and.returnValue(of(running));
    jobs.watch.and.returnValue(new Observable<BulkUploadJobView>());

    open();

    expect(jobs.findResumable).toHaveBeenCalledWith('customers');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(component.currentStep()).toBe(2);
    expect(component.isActive()).toBeTrue();
    expect(component.progressLabel()).toBe('Procesando lote 2/4 (100/400)');
    expect(component.progressPercent()).toBe(25);
    expect(component.clock.totalBatches()).toBe(4);
    expect(jobs.watch).toHaveBeenCalledWith(7, jasmine.any(Function));
  });

  it('un trabajo en cola muestra «En cola…»', () => {
    jobs.findResumable.and.returnValue(of(view({ status: 'queued' })));
    jobs.watch.and.returnValue(new Observable<BulkUploadJobView>());
    open();
    expect(component.progressLabel()).toBe('En cola…');
  });

  it('sin carga pendiente (o con error) abre el primer paso normal', () => {
    jobs.findResumable.and.returnValue(throwError(() => new Error('boom')));
    open();
    expect(component.checkingResumable()).toBeFalse();
    expect(component.currentStep()).toBe(0);
    expect(component.job()).toBeNull();
  });

  it('un resultado terminal recordado se muestra sin vigilar y cerrar lo olvida', () => {
    jobs.findResumable.and.returnValue(
      of(view({ status: 'completed', processed_rows: 400, successful_rows: 400 })),
    );
    jobs.getResults.and.returnValue(of(rows(3)));
    open();

    expect(jobs.watch).not.toHaveBeenCalled();
    expect(component.uploadResults()!.successful).toBe(400);
    expect(component.uploadResults()!.results.length).toBe(3);

    component.onCancel();
    expect(jobs.forget).toHaveBeenCalledWith('customers');
  });

  it('Cargar encola todas las filas con file_name/file_hash, no registra el log y muestra el resultado', async () => {
    parsed();
    (component as unknown as { fileName: string }).fileName = 'clientes.xlsx';
    (component as unknown as { fileHashPromise: Promise<string | null> }).fileHashPromise =
      Promise.resolve('hash-1');
    jobs.enqueue.and.returnValue(of(view({ status: 'queued' })));
    jobs.watch.and.callFake((_id, onProgress) => {
      onProgress(view({ batch_current: 0, processed_rows: 1 }));
      return of(
        view({
          status: 'completed',
          processed_rows: 2,
          successful_rows: 2,
          batch_current: 1,
          batch_total: 1,
        }),
      );
    });
    jobs.getResults.and.returnValue(of(rows(2)));

    await component.confirmUpload();

    expect(jobs.enqueue).toHaveBeenCalledWith('customers', {
      customers: [
        { row_number: 2, first_name: 'Ana', email: 'ana@x.co' },
        { row_number: 3, first_name: 'Luis' },
      ],
      file_name: 'clientes.xlsx',
      file_hash: 'hash-1',
    });
    expect(log.register).not.toHaveBeenCalled();
    expect(component.currentStep()).toBe(2);
    expect(component.isActive()).toBeFalse();
    expect(component.hasBulkResults()).toBeTrue();
    expect(component.uploadResults()!.successful).toBe(2);
    expect(component.uploadResults()!.results.length).toBe(2);
    expect(toast.success).toHaveBeenCalled();
  });

  it('no encola si la persona rechaza el aviso de archivo repetido', async () => {
    parsed();
    log.confirmFileIsNew.and.resolveTo(false);
    await component.confirmUpload();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('falla técnica con reintento posible: ticket, conteos y «Reintentar lote» manual con confirmación', async () => {
    const failed = view({
      status: 'failed',
      processed_rows: 100,
      successful_rows: 100,
      batch_current: 1,
      error: { kind: 'technical', code: 'X', message: 'Falla de plataforma' },
      incident_ticket_number: 'INC-20261117-ABC123',
      can_retry: true,
    });
    jobs.findResumable.and.returnValue(of(failed));
    jobs.getResults.and.returnValue(of(rows(100)));
    open();

    // Nada se reintentó solo.
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(jobs.watch).not.toHaveBeenCalled();
    expect(component.job()!.incident_ticket_number).toBe('INC-20261117-ABC123');
    expect(component.job()!.can_retry).toBeTrue();
    expect(component.uploadResults()!.results.length).toBe(100);

    jobs.retry.and.returnValue(of(view({ status: 'queued', batch_current: 1 })));
    jobs.watch.and.returnValue(new Observable<BulkUploadJobView>());
    await component.retryUpload();

    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(jobs.retry).toHaveBeenCalledOnceWith(7);
    expect(jobs.watch).toHaveBeenCalledWith(7, jasmine.any(Function));
    expect(component.isActive()).toBeTrue();
    expect(component.uploadResults()).toBeNull();
  });

  it('falla técnica recordada: «Subir otro archivo» la olvida y vuelve al inicio sin reenviar el lote', () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          processed_rows: 100,
          error: { kind: 'technical', code: 'X', message: 'Falla de plataforma' },
          can_retry: true,
        }),
      ),
    );
    jobs.getResults.and.returnValue(of(rows(100)));
    const closed = spyOn(component.isOpenChange, 'emit');
    open();
    fixture.detectChanges();

    // La plantilla está vacía en este spec: se prueba el manejador del botón.
    component.discardJob();
    fixture.detectChanges();

    expect(jobs.forget).toHaveBeenCalledOnceWith('customers');
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
    expect(component.currentStep()).toBe(0);
    expect(closed).not.toHaveBeenCalled();
  });

  it('cancelar la confirmación no reintenta', async () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          error: { kind: 'technical', code: null, message: 'x' },
          can_retry: true,
        }),
      ),
    );
    open();
    dialog.confirm.and.resolveTo(false);
    await component.retryUpload();
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('falla de datos: «Corrige tu archivo» y no hay reintento', async () => {
    jobs.findResumable.and.returnValue(
      of(
        view({
          status: 'failed',
          processed_rows: 100,
          error: { kind: 'data', code: 'X', message: 'Correo inválido en la fila 7' },
          can_retry: false,
        }),
      ),
    );
    open();

    const j = component.job()!;
    expect(j.status).toBe('failed');
    expect(j.error!.kind).toBe('data');
    expect(j.can_retry).toBeFalse();
    await component.retryUpload();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('409 BULK_JOB_ALREADY_ACTIVE avisa y carga el trabajo activo en el progreso', async () => {
    parsed();
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        error_code: 'BULK_JOB_ALREADY_ACTIVE',
        message: 'Ya hay una carga',
        details: { job_id: 9 },
      },
    });
    jobs.enqueue.and.returnValue(throwError(() => conflict));
    jobs.get.and.returnValue(of(view({ id: 9, batch_current: 2, processed_rows: 200 })));
    jobs.watch.and.returnValue(new Observable<BulkUploadJobView>());

    await component.confirmUpload();

    expect(toast.info).toHaveBeenCalledWith('Ya hay una carga de clientes en curso');
    expect(jobs.get).toHaveBeenCalledWith(9);
    expect(jobs.watch).toHaveBeenCalledWith(9, jasmine.any(Function));
    expect(component.currentStep()).toBe(2);
    expect(component.progressLabel()).toBe('Procesando lote 3/4 (200/400)');
  });

  it('otro error al encolar muestra el mensaje y deja el paso de verificación', async () => {
    parsed();
    component.currentStep.set(1);
    jobs.enqueue.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: { error_code: 'BULK_JOB_ENQUEUE_FAILED', message: 'Sin cola' },
          }),
      ),
    );

    await component.confirmUpload();

    expect(component.currentStep()).toBe(1);
    expect(component.isUploading()).toBeFalse();
    expect(component.uploadError()).toBeTruthy();
    expect(jobs.watch).not.toHaveBeenCalled();
  });

  it('cerrar mientras corre solo deja de vigilar y no olvida el trabajo', () => {
    jobs.findResumable.and.returnValue(of(view()));
    jobs.watch.and.returnValue(new Observable<BulkUploadJobView>());
    open();
    component.onCancel();
    expect(jobs.forget).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
    expect(component.currentStep()).toBe(0);
  });
});
