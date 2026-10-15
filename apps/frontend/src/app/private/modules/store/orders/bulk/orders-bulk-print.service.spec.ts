import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import {
  PosTicketService,
  TicketBatchPrintError,
  type TicketBatchPrintResult,
} from '../../pos/services/pos-ticket.service';
import { OrderTicketService } from '../services/order-ticket.service';
import {
  OrdersBulkPrintService,
  describeBulkPrintOutcome,
  printJobsNote,
} from './orders-bulk-print.service';
import { OrdersBulkService } from './orders-bulk.service';
import type { BulkPrintOutcome, BulkPrintPayload } from './orders-bulk.interface';

describe('OrdersBulkPrintService — formatos mezclados y errores', () => {
  const payload = (overrides: Partial<BulkPrintPayload> = {}): BulkPrintPayload =>
    ({
      total: 3,
      printable: 3,
      orders: [{ id: 1 }, { id: 2 }, { id: 3 }],
      skipped: [],
      failedIds: [],
      ...overrides,
    }) as unknown as BulkPrintPayload;

  const setup = (
    data: BulkPrintPayload,
    batch: (
      tickets: unknown[],
      options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
    ) => Promise<TicketBatchPrintResult>,
  ) => {
    const posTicket = {
      printTicketsBatch: jasmine.createSpy('printTicketsBatch').and.callFake(batch),
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: OrdersBulkService,
          useValue: { fetchPrintableOrdersInBatches: () => of(data) },
        },
        {
          provide: OrderTicketService,
          useValue: {
            toTicketData: (order: { id: number }) => ({
              id: String(order.id),
              orderId: order.id,
            }),
          },
        },
        { provide: PosTicketService, useValue: posTicket },
      ],
    });
    return { service: TestBed.inject(OrdersBulkPrintService), posTicket };
  };

  it('reporta las tandas y sus formatos cuando el lote salió en varios documentos', async () => {
    const { service } = setup(payload(), async () => ({
      rendered: 3,
      pages: 3,
      groups: 2,
      groupFormats: ['pos_electronic_invoice', 'pos_sale_ticket'],
      failedOrderIds: [],
      failedWithoutIdCount: 0,
    }));

    const outcome = await firstValueFrom(service.printSelection([1, 2, 3]));

    expect(outcome.rendered).toBe(3);
    expect(outcome.printJobs).toBe(2);
    expect(outcome.printJobLabels).toEqual(['factura electrónica', 'tiquete POS']);
    expect(outcome.failedIds).toEqual([]);
  });

  it('suma las órdenes que no llegaron al papel a failedIds con su motivo', async () => {
    const { service } = setup(payload({ failedIds: [9], failureMessage: 'Lote 2 caído.' }), async () => ({
      rendered: 2,
      pages: 2,
      groups: 1,
      groupFormats: ['pos_sale_ticket'],
      failedOrderIds: [3],
      failedWithoutIdCount: 0,
      failureMessage: '1 orden no se pudo preparar para imprimir.',
    }));

    const outcome = await firstValueFrom(service.printSelection([1, 2, 3, 9]));

    expect(outcome.failedIds).toEqual([9, 3]);
    expect(outcome.failureMessage).toBe(
      'Lote 2 caído. 1 orden no se pudo preparar para imprimir.',
    );
  });

  it('muestra el mensaje de un error de dominio en vez del genérico', async () => {
    spyOn(console, 'error');
    const { service } = setup(payload(), () =>
      Promise.reject(new TicketBatchPrintError('No se pudo enviar el documento a la impresora.', 'detalle')),
    );

    const outcome = await firstValueFrom(service.printSelection([1, 2, 3]));

    expect(outcome.rendered).toBe(0);
    expect(outcome.failureMessage).toBe('No se pudo enviar el documento a la impresora.');
    expect(outcome.failedIds).toEqual([1, 2, 3]);
  });

  it('no expone un TypeError crudo al operador', async () => {
    spyOn(console, 'error');
    const { service } = setup(payload(), () =>
      Promise.reject(new TypeError('Cannot read properties of undefined')),
    );

    const outcome = await firstValueFrom(service.printSelection([1, 2, 3]));

    expect(outcome.rendered).toBe(0);
    expect(outcome.failureMessage).not.toContain('Cannot read');
    expect(outcome.failureMessage).toContain('No se pudieron dibujar los tiquetes');
  });

  it('propaga como fallidas las órdenes sin id', async () => {
    const { service } = setup(payload(), async () => ({
      rendered: 2,
      pages: 2,
      groups: 1,
      groupFormats: ['pos_sale_ticket'],
      failedOrderIds: [],
      failedWithoutIdCount: 1,
      failureMessage: '1 orden no se pudo preparar para imprimir.',
    }));

    const outcome = await firstValueFrom(service.printSelection([1, 2, 3]));

    expect(outcome.failedWithoutIdCount).toBe(1);
  });

  it('aborta el ciclo de tandas y deja la barra en reposo al desuscribirse a mitad', async () => {
    let options!: {
      signal?: AbortSignal;
      onProgress?: (done: number, total: number) => void;
    };
    let finish!: (result: TicketBatchPrintResult) => void;
    const { service } = setup(payload(), (_tickets, opts) => {
      options = opts;
      return new Promise<TicketBatchPrintResult>((resolve) => (finish = resolve));
    });
    const next = jasmine.createSpy('next');

    const subscription = service.printSelection([1, 2, 3]).subscribe(next);
    options.onProgress?.(1, 3);
    expect(service.renderProgress()).toEqual({ done: 1, total: 3 });
    expect(options.signal?.aborted).toBeFalse();

    subscription.unsubscribe();

    expect(options.signal?.aborted).toBeTrue();
    expect(service.renderProgress()).toEqual({ done: 0, total: 0 });

    // La Promise termina después del teardown: no debe emitir nada.
    finish({
      rendered: 3, pages: 3, groups: 1, groupFormats: [], failedOrderIds: [], failedWithoutIdCount: 0,
    });
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('describeBulkPrintOutcome — texto para el operador', () => {
  const outcome = (overrides: Partial<BulkPrintOutcome> = {}): BulkPrintOutcome => ({
    rendered: 3,
    pages: 4,
    skipped: [],
    failedIds: [],
    printJobs: 1,
    printJobLabels: ['tiquete POS'],
    ...overrides,
  });

  it('confirma el envío al diálogo, no la impresión, cuando todo salió', () => {
    expect(describeBulkPrintOutcome(outcome(), 3)).toEqual({
      level: 'success',
      message: '3 de 3 órdenes enviadas al diálogo de impresión (4 páginas).',
    });
    expect(describeBulkPrintOutcome(outcome({ rendered: 1, pages: 1 }), 1).message)
      .toBe('1 de 1 órdenes enviadas al diálogo de impresión (1 página).');
  });

  it('explica las tandas cuando hubo varios diálogos', () => {
    expect(
      describeBulkPrintOutcome(
        outcome({ printJobs: 2, printJobLabels: ['factura electrónica', 'tiquete POS'] }),
        3,
      ).message,
    ).toBe(
      '3 de 3 órdenes enviadas al diálogo de impresión (4 páginas). ' +
        'Se enviaron en 2 tandas (un diálogo por tanda) porque las órdenes usan formatos distintos ' +
        '(factura electrónica / tiquete POS).',
    );
  });

  it('printJobsNote: vacío con una tanda; diseños o papeles con una sola etiqueta', () => {
    expect(printJobsNote(outcome())).toBe('');
    expect(printJobsNote(outcome({ printJobs: undefined }))).toBe('');
    expect(printJobsNote(outcome({ printJobs: 3, printJobLabels: ['tiquete POS'] }))).toBe(
      ' Se enviaron en 3 tandas (un diálogo por tanda) porque las órdenes usan diseños o papeles distintos.',
    );
  });

  it('muestra el mensaje real cuando nada se envió', () => {
    expect(
      describeBulkPrintOutcome(
        outcome({ rendered: 0, pages: 0, failureMessage: 'Ninguna orden es imprimible.' }),
        3,
      ),
    ).toEqual({ level: 'error', message: 'Ninguna orden es imprimible.' });
    expect(describeBulkPrintOutcome(outcome({ rendered: 0, pages: 0 }), 3).message).toBe(
      'No se pudo imprimir ninguna de las órdenes seleccionadas.',
    );
  });

  it('separa omitidas por el backend y fallidas, cada una con su conteo y motivo', () => {
    const result = describeBulkPrintOutcome(
      outcome({
        rendered: 3,
        skipped: [
          { id: 7, order_number: 'ORD-7', reason: 'non_printable_state', message: '' },
          { id: 8, reason: 'not_found', message: '' },
        ],
        failedIds: [9],
        failedWithoutIdCount: 1,
        failureMessage: 'Una de las tandas no se pudo enviar a la impresora.',
      }),
      7,
    );

    expect(result).toEqual({
      level: 'warning',
      message:
        '3 de 7 órdenes enviadas al diálogo de impresión. ' +
        '2 omitidas (ORD-7, #8): canceladas, reembolsadas o no disponibles. ' +
        '2 no se pudieron enviar: Una de las tandas no se pudo enviar a la impresora.',
    });
  });

  it('solo omitidas: no les atribuye un motivo de fallo y abrevia más de 3', () => {
    const skipped = [1, 2, 3, 4].map((id) => ({
      id, order_number: `ORD-${id}`, reason: 'non_printable_state' as const, message: '',
    }));
    expect(
      describeBulkPrintOutcome(
        outcome({ skipped, failureMessage: 'Lote 2 caído.' }),
        7,
      ).message,
    ).toBe(
      '3 de 7 órdenes enviadas al diálogo de impresión. ' +
        '4 omitidas (ORD-1, ORD-2, ORD-3…): canceladas, reembolsadas o no disponibles.',
    );
  });

  it('solo fallidas sin mensaje usa un motivo genérico y agrega la nota de tandas', () => {
    expect(
      describeBulkPrintOutcome(
        outcome({ failedIds: [5], printJobs: 2, printJobLabels: ['tiquete POS'] }),
        4,
      ).message,
    ).toBe(
      '3 de 4 órdenes enviadas al diálogo de impresión. ' +
        '1 no se pudo enviar: falló su preparación o su envío a la impresora. ' +
        'Se enviaron en 2 tandas (un diálogo por tanda) porque las órdenes usan diseños o papeles distintos.',
    );
  });
});
