import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import {
  PosTicketService,
  TicketBatchPrintError,
  type TicketBatchPrintResult,
} from '../../pos/services/pos-ticket.service';
import { OrderTicketService } from '../services/order-ticket.service';
import { OrdersBulkPrintService } from './orders-bulk-print.service';
import { OrdersBulkService } from './orders-bulk.service';
import type { BulkPrintPayload } from './orders-bulk.interface';

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
    batch: () => Promise<TicketBatchPrintResult>,
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
});
