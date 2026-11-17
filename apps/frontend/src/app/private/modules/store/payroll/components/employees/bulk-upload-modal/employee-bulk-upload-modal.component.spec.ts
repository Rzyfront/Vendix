import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';

import { EmployeeBulkUploadModalComponent } from './employee-bulk-upload-modal.component';
import { PayrollService } from '../../../services/payroll.service';
import { BulkUploadLogService } from '../../../../bulk-uploads/services/bulk-upload-log.service';
import { BulkUploadJobService } from '../../../../bulk-uploads/services/bulk-upload-job.service';
import { BulkUploadJobView } from '../../../../bulk-uploads/bulk-upload-log.interface';
import { ToastService } from '../../../../../../../shared/components';
import type { BulkEmployeeAnalysisResult } from '../../../interfaces/bulk-employee-analysis.interface';

/**
 * QUI-1009 — la carga de empleados corre como trabajo del servidor: el modal
 * encola, sigue el avance, retoma la carga al reabrirse y distingue un fallo
 * técnico (reanudable) de un error de datos.
 */
describe('EmployeeBulkUploadModalComponent — trabajo durable (QUI-1009)', () => {
  let fixture: ComponentFixture<EmployeeBulkUploadModalComponent>;
  let component: EmployeeBulkUploadModalComponent;

  const jobs = jasmine.createSpyObj<BulkUploadJobService>('BulkUploadJobService', [
    'enqueue',
    'get',
    'getResults',
    'retry',
    'watch',
    'findResumable',
    'forget',
  ]);
  const payroll = jasmine.createSpyObj<PayrollService>('PayrollService', [
    'analyzeBulkEmployees',
    'cancelBulkEmployeeSession',
  ]);
  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);

  function makeView(over: Partial<BulkUploadJobView>): BulkUploadJobView {
    return {
      id: 41,
      upload_type: 'employees',
      status: 'queued',
      file_name: 'empleados.xlsx',
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
    payroll.analyzeBulkEmployees.and.returnValue(
      of({
        session_id: 'sess-1',
        file_name: 'empleados.xlsx',
        file_hash: 'hash-1',
        duplicate_of: null,
        total_employees: 2,
        ready: 2,
        with_warnings: 0,
        with_errors: 0,
        employees: [],
      } as unknown as BulkEmployeeAnalysisResult),
    );
    payroll.cancelBulkEmployeeSession.and.returnValue(of<void>(undefined));

    await TestBed.configureTestingModule({
      imports: [EmployeeBulkUploadModalComponent],
      providers: [
        { provide: PayrollService, useValue: payroll },
        { provide: BulkUploadJobService, useValue: jobs },
        {
          provide: BulkUploadLogService,
          useValue: { confirmDuplicate: () => Promise.resolve(true) },
        },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(EmployeeBulkUploadModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EmployeeBulkUploadModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  async function analyzeAndUpload(): Promise<void> {
    component.selectedFile.set(new File(['x'], 'empleados.xlsx'));
    component.analyzeFile();
    await component.proceedWithUpload();
  }

  it('al reabrir con un trabajo en curso muestra «Procesando lote 3/5 (200/500)» sin encolar de nuevo', () => {
    const running = makeView({
      status: 'running',
      batch_current: 2,
      batch_total: 5,
      processed_rows: 200,
      total_rows: 500,
    });
    jobs.findResumable.and.returnValue(of(running));

    openModal();

    expect(jobs.findResumable).toHaveBeenCalledWith('employees');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(jobs.watch).toHaveBeenCalledWith(41, jasmine.any(Function));
    expect(component.currentStep()).toBe(2);
    expect(component.isResuming()).toBeFalse();
    expect(component.progressLabel()).toBe('Procesando lote 3/5 (200/500)');
    expect(component.progressPercent()).toBe(40);
  });

  it('muestra «En cola…» y el aviso de reintento técnico del servidor', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'running',
          retry: { attempt: 1, max_attempts: 3, next_retry_at: '2026-11-17T10:00:02Z', message: 'x' },
        }),
      ),
    );
    openModal();
    expect(component.retryNotice()).toBe('Problema técnico, reintentando (1/3)…');

    component.job.set(makeView({ status: 'queued' }));
    expect(component.progressLabel()).toBe('En cola…');
  });

  it('Cargar encola con el cuerpo exacto y un trabajo completed muestra las filas y avisa a la pantalla', async () => {
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
        { row_number: 2, status: 'success', message: 'Creado', employee_name: 'Ana', document_number: '1', action: 'created' },
        { row_number: 3, status: 'success', message: 'Actualizado', employee_name: 'Luis', document_number: '2', action: 'updated' },
      ]),
    );
    let emitted = 0;
    component.uploadComplete.subscribe(() => emitted++);

    await analyzeAndUpload();

    expect(jobs.enqueue).toHaveBeenCalledOnceWith('employees', {
      session_id: 'sess-1',
      file_name: 'empleados.xlsx',
      file_hash: 'hash-1',
    });
    expect(jobs.getResults).toHaveBeenCalledWith(41);
    expect(component.isUploading()).toBeFalse();
    expect(component.uploadResults()?.successful).toBe(2);
    expect(component.uploadResults()?.results.length).toBe(2);
    expect(component.uploadResults()?.updated).toBe(1);
    expect(emitted).toBe(1);
  });

  it('un 409 BULK_JOB_ALREADY_ACTIVE avisa y carga el trabajo activo', async () => {
    jobs.enqueue.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          error_code: 'BULK_JOB_ALREADY_ACTIVE',
          message: 'Ya hay una carga activa',
          details: { job_id: 77 },
        },
      })),
    );
    jobs.get.and.returnValue(of(makeView({ id: 77, status: 'running', batch_current: 1 })));

    await analyzeAndUpload();

    expect(toast.warning).toHaveBeenCalledWith('Ya hay una carga de empleados en curso');
    expect(jobs.get).toHaveBeenCalledWith(77);
    expect(jobs.watch).toHaveBeenCalledWith(77, jasmine.any(Function));
    expect(component.currentStep()).toBe(2);
  });

  it('failed técnico: «tu carga no se perdió», ticket y Reanudar carga', () => {
    const failed = makeView({
      status: 'failed',
      processed_rows: 200,
      error: { kind: 'technical', code: 'BULK_JOB_TIMEOUT', message: 'Tiempo agotado' },
      incident_ticket_number: 'INC-20261117-ABC123',
      can_retry: true,
    });
    jobs.findResumable.and.returnValue(of(failed));
    jobs.retry.and.returnValue(of(makeView({ status: 'queued' })));

    openModal();

    expect(component.technicalFailure()).toBeTrue();
    expect(component.dataFailure()).toBeFalse();
    expect(component.job()?.incident_ticket_number).toBe('INC-20261117-ABC123');
    expect(jobs.getResults).toHaveBeenCalledWith(41);
    expect(jobs.watch).not.toHaveBeenCalled();

    component.retryJob();

    expect(jobs.retry).toHaveBeenCalledWith(41);
    expect(jobs.watch).toHaveBeenCalledWith(41, jasmine.any(Function));
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

    expect(jobs.forget).toHaveBeenCalledOnceWith('employees');
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(component.job()).toBeNull();
    expect(component.technicalFailure()).toBeFalse();
    expect(component.currentStep()).toBe(0);
    expect(closed).not.toHaveBeenCalled();
  });

  it('failed de datos: «Corrige tu archivo» con el motivo y sin reanudar', () => {
    jobs.findResumable.and.returnValue(
      of(
        makeView({
          status: 'failed',
          error: { kind: 'data', code: 'PAYROLL_BULK_SESSION_EXPIRED', message: 'La sesión venció' },
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

    component.onCancel();
    expect(jobs.forget).not.toHaveBeenCalled();
    expect(payroll.cancelBulkEmployeeSession).not.toHaveBeenCalled();

    jobs.findResumable.and.returnValue(of(makeView({ status: 'completed', successful_rows: 1 })));
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    openModal();
    component.onCancel();
    expect(jobs.forget).toHaveBeenCalledWith('employees');
  });
});
