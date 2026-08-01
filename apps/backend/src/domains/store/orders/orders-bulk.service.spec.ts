import { Test } from '@nestjs/testing';
import { OrdersBulkService } from './orders-bulk.service';
import { OrderFlowService } from './order-flow/order-flow.service';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { DispatchRoutesService } from '../dispatch-routes/dispatch-routes.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

describe('OrdersBulkService', () => {
  let service: OrdersBulkService;
  let orderFlowService: { forceOrderState: jest.Mock };
  let dispatchNotesService: { createFromOrdersBatch: jest.Mock };
  let dispatchRoutesService: { addStops: jest.Mock };
  let prisma: {
    orders: { findMany: jest.Mock };
    store_settings: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    orderFlowService = {
      forceOrderState: jest.fn(),
    };
    dispatchNotesService = {
      createFromOrdersBatch: jest.fn(),
    };
    dispatchRoutesService = {
      addStops: jest.fn(),
    };
    prisma = {
      orders: { findMany: jest.fn() },
      store_settings: { findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersBulkService,
        { provide: StorePrismaService, useValue: prisma },
        { provide: OrderFlowService, useValue: orderFlowService },
        { provide: DispatchNotesService, useValue: dispatchNotesService },
        { provide: DispatchRoutesService, useValue: dispatchRoutesService },
      ],
    }).compile();

    service = moduleRef.get(OrdersBulkService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('bulkTransition', () => {
    it('calls forceOrderState per id and returns a partial result on mixed outcomes', async () => {
      orderFlowService.forceOrderState
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('kitchen items pending'));

      const result = await service.bulkTransition({
        ids: [1, 2],
        targetState: 'finished',
      } as any);

      expect(orderFlowService.forceOrderState).toHaveBeenCalledTimes(2);
      expect(orderFlowService.forceOrderState).toHaveBeenCalledWith(
        1,
        'finished',
        expect.objectContaining({ reason: expect.any(String) }),
      );

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toEqual({
        id: 1,
        status: 'ok',
        message: expect.stringContaining('finished'),
      });
      expect(result.results[1].status).toBe('error');
      expect(result.results[1].id).toBe(2);
    });

    it('uses a default reason when none is provided', async () => {
      orderFlowService.forceOrderState.mockResolvedValue(undefined);

      const result = await service.bulkTransition({
        ids: [10],
        targetState: 'shipped',
      } as any);

      expect(result.successful).toBe(1);
      expect(orderFlowService.forceOrderState).toHaveBeenCalledWith(
        10,
        'shipped',
        expect.objectContaining({ reason: expect.stringContaining('QUI-599') }),
      );
    });
  });

  describe('bulkAssignRoute', () => {
    it('maps created notes to ok and calls addStops once with all note ids', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'created',
            order_id: 1,
            dispatch_note_id: 501,
            dispatch_number: 'DSP-501',
          },
          {
            status: 'created',
            order_id: 2,
            dispatch_note_id: 502,
            dispatch_number: 'DSP-502',
          },
        ],
        partial: false,
      });
      dispatchRoutesService.addStops.mockResolvedValue(undefined);

      const result = await service.bulkAssignRoute({
        ids: [1, 2],
        route_id: 7,
      } as any);

      expect(dispatchNotesService.createFromOrdersBatch).toHaveBeenCalledWith(
        expect.objectContaining({ orders: [1, 2], target_status: 'confirmed' }),
      );
      expect(dispatchRoutesService.addStops).toHaveBeenCalledTimes(1);
      expect(dispatchRoutesService.addStops).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          stops: [
            { dispatch_note_id: 501 },
            { dispatch_note_id: 502 },
          ],
        }),
      );

      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('reports failed rows when a note creation fails', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'failed',
            order_id: 1,
            error_code: 'DSP_ORDER_FAIL',
            message: 'order not found',
          },
          {
            status: 'created',
            order_id: 2,
            dispatch_note_id: 502,
            dispatch_number: 'DSP-502',
          },
        ],
        partial: true,
      });
      dispatchRoutesService.addStops.mockResolvedValue(undefined);

      const result = await service.bulkAssignRoute({
        ids: [1, 2],
        route_id: 7,
      } as any);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[1].status).toBe('ok');
    });

    it('warns on ok rows when addStops fails after notes were created', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'created',
            order_id: 1,
            dispatch_note_id: 501,
            dispatch_number: 'DSP-501',
          },
        ],
        partial: false,
      });
      dispatchRoutesService.addStops.mockRejectedValue(
        new Error('route not editable'),
      );

      const result = await service.bulkAssignRoute({
        ids: [1],
        route_id: 7,
      } as any);

      expect(result.successful).toBe(1);
      expect(result.results[0].status).toBe('ok');
      expect(result.results[0].message).toContain('ADVERTENCIA');
    });
  });

  // ─── Print ───────────────────────────────────────────────────────────

  describe('partitionPrintable', () => {
    /**
     * `partitionPrintable` es privado a propósito (es un detalle del reparto,
     * no API del service). Se prueba a través del índice porque es la única
     * pieza donde un error de orden o de clasificación es invisible en el
     * resultado agregado: `printable + skipped.length === total` se cumple
     * igual con las órdenes en el orden equivocado.
     */
    const partition = (ids: number[], orders: any[]) =>
      (service as any).partitionPrintable(ids, orders);

    it('respects the order of `ids`, not the order returned by findMany', () => {
      const orders = [
        { id: 3, order_number: 'ORD-3', state: 'delivered' },
        { id: 1, order_number: 'ORD-1', state: 'finished' },
        { id: 2, order_number: 'ORD-2', state: 'processing' },
      ];

      const { printable, skipped } = partition([1, 2, 3], orders);

      expect(printable.map((o: any) => o.id)).toEqual([1, 2, 3]);
      expect(skipped).toEqual([]);
    });

    it('classifies both skip reasons and keeps the invariant', () => {
      const orders = [
        { id: 1, order_number: 'ORD-1', state: 'finished' },
        { id: 2, order_number: 'ORD-2', state: 'cancelled' },
        { id: 3, order_number: 'ORD-3', state: 'refunded' },
        // el id 4 no vuelve del findMany: borrado o de otra tienda
      ];

      const { printable, skipped } = partition([1, 2, 3, 4], orders);

      expect(printable.map((o: any) => o.id)).toEqual([1]);
      expect(skipped).toEqual([
        expect.objectContaining({ id: 2, reason: 'non_printable_state' }),
        expect.objectContaining({ id: 3, reason: 'non_printable_state' }),
        expect.objectContaining({ id: 4, reason: 'not_found' }),
      ]);
      // `not_found` no puede nombrar la orden: no hubo fila que leer.
      expect(skipped[2].order_number).toBeUndefined();
      expect(skipped[0].order_number).toBe('ORD-2');
      expect(printable.length + skipped.length).toBe(4);
    });

    it('keeps `draft` printable — a draft is an order under construction', () => {
      const { printable, skipped } = partition(
        [1],
        [{ id: 1, order_number: 'ORD-1', state: 'draft' }],
      );

      expect(printable).toHaveLength(1);
      expect(skipped).toEqual([]);
    });
  });

  describe('bulkPrint', () => {
    const row = (id: number, state = 'finished') => ({
      id,
      order_number: `ORD-${id}`,
      state,
      order_items: [],
      users: null,
      payments: [],
      invoices: [],
      stores: { id: 10, name: 'Tienda' },
    });

    beforeEach(() => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 10 } as any);
      prisma.store_settings.findUnique.mockResolvedValue({
        settings: { receipts: { pos_ticket_format: 'thermal_58' } },
      });
    });

    it('returns the printable orders, the paper format and the full skip list', async () => {
      prisma.orders.findMany.mockResolvedValue([
        row(1),
        row(2, 'cancelled'),
        row(3, 'delivered'),
      ]);

      const result = await service.bulkPrint({ ids: [1, 2, 3, 99] } as any);

      expect(result.total).toBe(4);
      expect(result.printable).toBe(2);
      expect(result.orders.map((o: any) => o.id)).toEqual([1, 3]);
      expect(result.orders).toHaveLength(result.printable);
      expect(result.pos_ticket_format).toBe('thermal_58');
      // El detalle va COMPLETO en el body: ya no se trunca como en la cabecera.
      expect(result.skipped).toHaveLength(2);
      expect(result.printable + result.skipped.length).toBe(result.total);
    });

    it('asks Prisma for payments, the accepted DIAN invoice and users.phone', async () => {
      prisma.orders.findMany.mockResolvedValue([row(1)]);

      await service.bulkPrint({ ids: [1] } as any);

      const args = prisma.orders.findMany.mock.calls[0][0];

      // Sin `payments` el tiquete pierde "Efectivo recibido" / "Cambio".
      expect(args.include.payments).toEqual(
        expect.objectContaining({ where: { state: 'succeeded' } }),
      );
      expect(args.include.payments.select).toEqual(
        expect.objectContaining({ gateway_response: true }),
      );

      // El NOMBRE del método de pago no está en `gateway_response`: el cobro
      // POS guarda el método como FK. Sin esta relación el tiquete imprime
      // "Método de pago: N/A" aunque `payments` esté incluido.
      expect(
        args.include.payments.select.store_payment_method,
      ).toBeDefined();

      // El pie afirma "validada por la DIAN": solo `accepted` lo respalda.
      expect(args.include.invoices).toEqual(
        expect.objectContaining({
          where: { dian_status: 'accepted' },
          take: 1,
        }),
      );

      expect(args.include.users.select.phone).toBe(true);

      // Lo que el layout de factura de PDFKit arrastraba y el tiquete no lee.
      expect(
        args.include.addresses_orders_billing_address_idToaddresses,
      ).toBeUndefined();
      expect(args.include.stores.select.organizations).toBeUndefined();
      expect(args.include.stores.select.store_settings).toBeUndefined();
    });

    it('throws ORD_BULK_PRINT_001 when nothing in the selection is printable', async () => {
      prisma.orders.findMany.mockResolvedValue([
        row(1, 'cancelled'),
        row(2, 'refunded'),
      ]);

      await expect(
        service.bulkPrint({ ids: [1, 2] } as any),
      ).rejects.toMatchObject({
        errorCode: 'ORD_BULK_PRINT_001',
      });
      await expect(
        service.bulkPrint({ ids: [1, 2] } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);

      // No se pide el formato: no hay nada que imprimir.
      expect(prisma.store_settings.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to thermal_80 — never letter — when the setting is absent or invalid', async () => {
      prisma.orders.findMany.mockResolvedValue([row(1)]);
      prisma.store_settings.findUnique.mockResolvedValue({
        settings: { receipts: { invoice_format: 'letter' } },
      });

      const result = await service.bulkPrint({ ids: [1] } as any);

      // `invoice_format` NO participa: el documento es el tiquete POS.
      expect(result.pos_ticket_format).toBe('thermal_80');
      // Sin `pos_ticket_copies` en settings, una copia.
      expect(result.pos_ticket_copies).toBe(1);
    });

    it('returns pos_ticket_copies clamped to [1, 5]', async () => {
      prisma.orders.findMany.mockResolvedValue([row(1)]);

      // 0 significa "no imprimir automáticamente tras la venta"; quien pulsa
      // Imprimir pidió papel, así que el piso es 1 y no 0.
      for (const [configured, expected] of [
        [3, 3],
        [0, 1],
        [-2, 1],
        [9, 5],
        [2.7, 2],
        ['nope', 1],
        [null, 1],
      ] as const) {
        prisma.store_settings.findUnique.mockResolvedValue({
          settings: {
            receipts: {
              pos_ticket_format: 'thermal_80',
              pos_ticket_copies: configured,
            },
          },
        });

        const result = await service.bulkPrint({ ids: [1] } as any);

        expect(result.pos_ticket_copies).toBe(expected);
      }
    });

    it('reads copies from the DB, not from the caller-supplied dto', async () => {
      prisma.orders.findMany.mockResolvedValue([row(1)]);
      prisma.store_settings.findUnique.mockResolvedValue({
        settings: { receipts: { pos_ticket_copies: 2 } },
      });

      // `copies` quedó @deprecated en el DTO: el backend ya no dibuja, y las
      // copias canónicas son las de la tienda. Un cliente que lo mande no debe
      // poder cambiar el gasto de papel.
      const result = await service.bulkPrint({ ids: [1], copies: 5 } as any);

      expect(result.pos_ticket_copies).toBe(2);
    });

    it('throws STORE_CONTEXT_001 without a store in context', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue(undefined as any);

      await expect(
        service.bulkPrint({ ids: [1] } as any),
      ).rejects.toMatchObject({ errorCode: 'STORE_CONTEXT_001' });
      expect(prisma.orders.findMany).not.toHaveBeenCalled();
    });
  });
});