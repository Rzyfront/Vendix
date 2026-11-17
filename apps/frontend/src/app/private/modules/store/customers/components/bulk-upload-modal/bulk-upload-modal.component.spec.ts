import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, defer, map, of, throwError, timer } from 'rxjs';

import { CustomerBulkUploadModalComponent } from './bulk-upload-modal.component';
import { CustomersService } from '../../services/customers.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import { ToastService } from '../../../../../../shared/components';

/**
 * QUI-1009 — la carga de clientes NO es idempotente (una fila sin correo ni
 * documento se crea de nuevo al reenviarla), así que un 5xx nunca se reintenta
 * solo: se ofrece «Reintentar lote» con advertencia. Un rechazo de datos no se
 * reintenta. El progreso muestra cronómetro, estimado y «lote x/y».
 */
describe('CustomerBulkUploadModalComponent — progreso y fallos por lote (QUI-1009)', () => {
  const TOTAL = 250; // 3 lotes de 100
  let fixture: ComponentFixture<CustomerBulkUploadModalComponent>;
  let component: CustomerBulkUploadModalComponent;
  let sent: number[];
  let respond: (chunk: { row_number: number }[], call: number) => Observable<unknown>;
  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'warning',
    'error',
    'info',
  ]);

  const ok = (chunk: { row_number: number }[]) => ({
    data: {
      total_processed: chunk.length,
      successful: chunk.length,
      failed: 0,
      locations_added: 0,
      warnings: 0,
      results: chunk.map((c) => ({
        row_number: c.row_number,
        status: 'success',
        message: 'Cliente creado exitosamente',
      })),
    },
  });

  const http = (status: number, error: unknown = null) =>
    new HttpErrorResponse({ status, error, url: '/api/store/customers/bulk/upload' });

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    sent = [];
    respond = (chunk) => of(ok(chunk));
    toast.success.calls.reset();
    toast.warning.calls.reset();
    toast.error.calls.reset();

    await TestBed.configureTestingModule({
      imports: [CustomerBulkUploadModalComponent],
      providers: [
        {
          provide: CustomersService,
          useValue: {
            uploadBulkCustomersJson: (chunk: { row_number: number }[]) =>
              defer(() => {
                sent.push(chunk[0].row_number);
                return respond(chunk, sent.length);
              }),
          },
        },
        {
          provide: BulkUploadLogService,
          useValue: {
            confirmFileIsNew: () => Promise.resolve(true),
            register: () => of(null),
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(CustomerBulkUploadModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CustomerBulkUploadModalComponent);
    component = fixture.componentInstance;
    component.parsedData.set(
      Array.from({ length: TOTAL }, (_, i) => ({
        row_number: i + 2,
        first_name: `Cliente ${i + 1}`,
      })),
    );
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('un 5xx NO se reintenta solo: ofrece «Reintentar lote» como problema técnico', async () => {
    respond = (chunk, call) => (call === 2 ? throwError(() => http(502)) : of(ok(chunk)));

    await component.confirmUpload();
    jasmine.clock().tick(60_000);

    expect(sent).toEqual([2, 102]);
    expect(component.isUploading()).toBeFalse();
    expect(component.failureKind()).toBe('technical');
    expect(component.failedAt()).toBe(100);
    expect(component.uploadError()).toBe('El servidor respondió con un error HTTP 502.');
    expect(component.uploadProgress()).toEqual({ processed: 100, total: TOTAL });
    expect(toast.error).toHaveBeenCalledWith(
      'Problema técnico de la plataforma. Se guardaron 100 de 250.',
    );

    // El reintento lo decide la persona y reanuda desde el lote que falló.
    component.retryUpload();
    expect(sent).toEqual([2, 102, 102, 202]);
    expect(component.failureKind()).toBeNull();
    expect(component.failedAt()).toBeNull();
    expect(component.uploadResults().successful).toBe(TOTAL);
    expect(toast.success).toHaveBeenCalled();
  });

  it('un error de datos no se reintenta y lista las filas rechazadas', async () => {
    respond = (chunk, call) =>
      call === 1
        ? throwError(() =>
            http(400, {
              message: 'Se encontraron 1 error(es) de validación en la carga masiva',
              details: {
                validationErrors: [
                  { row: 7, column: 'Correo', value: 'x@', message: 'Correo inválido' },
                ],
              },
            }),
          )
        : of(ok(chunk));

    await component.confirmUpload();
    jasmine.clock().tick(60_000);

    expect(sent).toEqual([2]);
    expect(component.failureKind()).toBe('data');
    expect(component.uploadError()).toBe(
      'Se encontraron 1 error(es) de validación en la carga masiva',
    );
    expect(component.failureDetails()).toEqual([
      'Fila 7 — Columna: Correo — Valor: "x@" — Correo inválido',
    ]);

    component.retryUpload();
    expect(sent).toEqual([2]);
    expect(component.failedAt()).toBe(0);
  });

  it('el cronómetro, el estimado y el «lote x/y» se actualizan con el ritmo real', async () => {
    respond = (chunk) => timer(3_000).pipe(map(() => ok(chunk)));

    await component.confirmUpload();
    expect(component.clock.currentBatch()).toBe(1);
    expect(component.clock.totalBatches()).toBe(3);
    expect(component.clock.remainingLabel()).toBeNull();

    jasmine.clock().tick(3_000);
    expect(component.clock.currentBatch()).toBe(2);
    expect(component.clock.elapsedLabel()).toBe('3 s');
    expect(component.clock.remainingMs()).toBe(6_000);

    jasmine.clock().tick(2_000);
    expect(component.clock.elapsedLabel()).toBe('5 s');
    expect(component.clock.remainingMs()).toBe(4_000);

    jasmine.clock().tick(4_000);
    expect(component.isUploading()).toBeFalse();
    expect(component.clock.elapsedMs()).toBe(9_000);
    expect(component.clock.running()).toBeFalse();
  });
});
