import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TableSessionsService } from './table-sessions.service';
import { TablesService } from './tables.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

describe('TableSessionsService — open + addItems (Fase E smoke)', () => {
  let service: TableSessionsService;
  let tablesService: TablesService;
  let settingsService: any;
  let prismaMock: any;
  let context: any;

  const STORE_ID = 100;
  const USER_ID = 42;

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    };

    prismaMock = {
      tables: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      table_sessions: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      orders: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        // findUnique se usa para leer `state` antes de mutar (legado).
        // El fix del P0 deja de consultarlo, pero el mock se mantiene para
        // que los asserts `expect(prismaMock.orders.findUnique).not.toHaveBeenCalled()`
        // tengan un spy válido con el cual comparar (jest exige mock o spy).
        findUnique: jest.fn(),
      },
      order_items: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      products: {
        findMany: jest.fn(),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ currency: 'COP' }),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context);

    tablesService = {
      getById: jest.fn(),
      getActiveSession: jest.fn(),
    } as any;

    settingsService = {
      getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      // openSession gates anonymous (customer_id null) opens behind
      // pos.allow_anonymous_sales — allow it so the smoke test can open.
      getSettings: jest.fn().mockResolvedValue({
        pos: { allow_anonymous_sales: true },
      }),
    };

    // Deps added after this smoke test was first written. Only
    // notificationsSseService.push is exercised here (emitSessionOpened fires
    // on open); the rest are stubbed so the 10-arg constructor is satisfied.
    const notificationsService = {
      createAndBroadcast: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };
    const notificationsSseService = { push: jest.fn() };
    const eventEmitter = { emit: jest.fn() };
    const cashRegisterSessionsService = { getActiveSession: jest.fn() };
    const cashRegisterMovementsService = { recordSaleMovement: jest.fn() };
    const kitchenFireService = {
      cancelTicketInTx: jest.fn(),
      emitTicketCancelledEvent: jest.fn(),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn(),
      updateStock: jest.fn(),
    };

    service = new TableSessionsService(
      prismaMock as any,
      tablesService as any,
      settingsService,
      notificationsService as any,
      notificationsSseService as any,
      eventEmitter as any,
      cashRegisterSessionsService as any,
      cashRegisterMovementsService as any,
      kitchenFireService as any,
      stockLevelManager as any,
      { markItemDelivered: jest.fn() } as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('openSession', () => {
    it('creates a draft order + table_session, flips table to occupied', async () => {
      (tablesService.getById as jest.Mock).mockResolvedValue({
        id: 5,
        store_id: STORE_ID,
        name: 'Mesa 5',
        zone: null,
        capacity: 4,
        status: 'available',
        pos_x: null,
        pos_y: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue(
        null,
      );

      prismaMock.orders.create.mockResolvedValue({
        id: 9001,
        order_number: 'T-1234-001',
      });
      prismaMock.table_sessions.create.mockResolvedValue({
        id: 77,
        order_id: 9001,
        table_id: 5,
        opened_by: USER_ID,
        opened_at: new Date(),
        closed_at: null,
        guest_count: 4,
      });
      prismaMock.tables.update.mockResolvedValue({});

      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 77,
        store_id: STORE_ID,
        table_id: 5,
        order_id: 9001,
        opened_by: USER_ID,
        opened_at: new Date(),
        closed_at: null,
        guest_count: 4,
        order: {
          id: 9001,
          state: 'draft',
          grand_total: new Prisma.Decimal(0),
          subtotal_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
          discount_amount: new Prisma.Decimal(0),
          order_items: [],
        },
        table: {
          id: 5,
          name: 'Mesa 5',
          zone: null,
          status: 'occupied',
        },
      });

      const result = await service.openSession({
        table_id: 5,
        guest_count: 4,
      } as any);

      expect(result.id).toBe(77);
      expect(prismaMock.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'draft',
            store_id: STORE_ID,
          }),
        }),
      );
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
    });

    it('rejects when the table already has an open session', async () => {
      (tablesService.getById as jest.Mock).mockResolvedValue({
        id: 5,
        status: 'occupied',
      });
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue({
        id: 99,
      });

      await expect(
        service.openSession({ table_id: 5 } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(prismaMock.orders.create).not.toHaveBeenCalled();
    });
  });

  describe('addItems', () => {
    it('rejects adding items to a closed session', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: new Date(),
        table_id: 5,
        order: { state: 'draft', order_items: [] },
      });
      await expect(
        service.addItems(1, { items: [{ product_id: 1, quantity: 1 }] } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('appends lines and re-derives totals in a single transaction', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: {
          id: 100,
          state: 'draft',
          grand_total: 0,
          subtotal_amount: 0,
          tax_amount: 0,
          discount_amount: 0,
          order_items: [],
        },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: 50,
          name: 'Hamburguesa',
          base_price: 25000,
          is_sellable: true,
          product_type: 'prepared',
          track_inventory: false,
        },
      ]);
      prismaMock.order_items.findMany.mockResolvedValue([
        { total_price: new Prisma.Decimal(50000), tax_amount_item: null },
      ]);
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});
      prismaMock.table_sessions.findFirst.mockResolvedValueOnce({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: { state: 'draft', order_items: [] },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });

      await service.addItems(1, {
        items: [{ product_id: 50, quantity: 2 }],
      } as any);
      expect(prismaMock.order_items.create).toHaveBeenCalled();
      expect(prismaMock.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({
            grand_total: expect.any(Prisma.Decimal),
          }),
        }),
      );
    });
  });

  describe('openTableSessionPublic (QR-por-mesa, Fase 7)', () => {
    const PUBLIC_STORE_ID = 200;

    /**
     * Runs `openTableSessionPublic` with a context that has NO
     * `user_id` (anonymous QR diner). Returns the mocks-backed result
     * and exposes the order creation payload for assertions.
     */
    async function runPublicOpen(tableId: number, existingSession: any) {
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue(
        existingSession,
      );
      prismaMock.orders.create.mockResolvedValue({
        id: 7001,
        order_number: 'T-pub-001',
      });
      prismaMock.table_sessions.create.mockResolvedValue({
        id: 88,
        order_id: 7001,
        table_id: tableId,
        opened_by: null,
        opened_at: new Date(),
        closed_at: null,
        guest_count: null,
      });
      prismaMock.tables.update.mockResolvedValue({});
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 88,
        store_id: PUBLIC_STORE_ID,
        table_id: tableId,
        order_id: 7001,
        opened_by: null,
        opened_at: new Date(),
        closed_at: null,
        guest_count: null,
        order: {
          id: 7001,
          state: 'draft',
          grand_total: new Prisma.Decimal(0),
          subtotal_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
          discount_amount: new Prisma.Decimal(0),
          order_items: [],
        },
        table: {
          id: tableId,
          name: 'Mesa QR',
          zone: null,
          status: 'occupied',
        },
      });

      return service.openTableSessionPublic(tableId);
    }

    it('creates an anonymous session with opened_by=null and dine_in/ecommerce order', async () => {
      // Anonymous context: store_id present, user_id ABSENT.
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: PUBLIC_STORE_ID,
        organization_id: 1,
        is_super_admin: false,
      } as any);

      const result = await runPublicOpen(7, null);

      expect(result.id).toBe(88);
      expect(result.opened_by).toBeNull();
      // Order created with the QR-specific channel + delivery_type.
      expect(prismaMock.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            store_id: PUBLIC_STORE_ID,
            channel: 'ecommerce',
            delivery_type: 'dine_in',
            customer_id: null,
            state: 'draft',
          }),
        }),
      );
      // Session created with opened_by null (anonymous opener).
      expect(prismaMock.table_sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            table_id: 7,
            store_id: PUBLIC_STORE_ID,
            opened_by: null,
            guest_count: null,
          }),
        }),
      );
      // Table flipped to occupied.
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
    });

    it('does NOT throw STORE_CONTEXT_001 when user_id is absent', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: PUBLIC_STORE_ID,
        organization_id: 1,
        is_super_admin: false,
      } as any);

      await expect(runPublicOpen(7, null)).resolves.not.toThrow();
      // Sanity: the store-only context was enough — no orders.create
      // rejection path was triggered by a missing user_id.
      expect(prismaMock.orders.create).toHaveBeenCalled();
    });

    it('is idempotent: a second call returns the existing active session', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: PUBLIC_STORE_ID,
        organization_id: 1,
        is_super_admin: false,
      } as any);

      // First call creates a fresh session (no active session yet).
      await runPublicOpen(7, null);
      expect(prismaMock.table_sessions.create).toHaveBeenCalledTimes(1);

      // Second call: an active session already exists for the table.
      // The helper returns it without creating a new one.
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue({
        id: 88,
        order_id: 7001,
        table_id: 7,
      });
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 88,
        store_id: PUBLIC_STORE_ID,
        table_id: 7,
        order_id: 7001,
        opened_by: null,
        opened_at: new Date(),
        closed_at: null,
        guest_count: null,
        order: {
          id: 7001,
          state: 'draft',
          grand_total: new Prisma.Decimal(0),
          subtotal_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
          discount_amount: new Prisma.Decimal(0),
          order_items: [],
        },
        table: { id: 7, name: 'Mesa QR', zone: null, status: 'occupied' },
      });

      const second = await service.openTableSessionPublic(7);
      expect(second.id).toBe(88);
      // No NEW session created — create still at 1 call from the first open.
      expect(prismaMock.table_sessions.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.orders.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeSession (FIX/ table-close-order — option 2)', () => {
    // Helper para armar una session activa con `order_id` mockeado.
    const mockSession = (overrides: Partial<{ closed_at: Date | null; order_id: number }> = {}) => ({
      id: 77,
      table_id: 5,
      store_id: STORE_ID,
      order_id: 10,
      closed_at: null,
      opened_at: new Date(),
      opened_by: USER_ID,
      ...overrides,
    });

    // ─── P0 revenue integrity (option 2) ─────────────────────────────────
    //
    // La versión previa de `closeSession` subía `orders.state` a `'finished'`
    // cuando el bound order estaba en `draft` / `created` / `pending_payment`.
    // Eso contaminaba `COMPLETED_SALE_STATES` (analytics-metrics.contract.ts:29
    // = ['delivered', 'finished']) y sumaba la orden a los ingresos del período
    // con `total_paid = 0` — overview-analytics / sales-analytics /
    // financial-analytics / weekly-report.
    //
    // Opción 2 del review: `closeSession` NO toca `orders.state`. La orden
    // queda en su estado editable y sigue siendo cobrable por el flujo de
    // pagos. La edición la bloquea `OrdersService.updateOrderFromEditor`
    // cuando la sesión está cerrada (síntoma QUI-726), no este método.

    it('does NOT touch the order state when the order is in "draft" (option 2)', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      // orders.findUnique NO debe consultarse — no necesitamos leer state.
      expect(prismaMock.orders.findUnique).not.toHaveBeenCalled();
      // orders.update NO debe llamarse para cambio de estado.
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      // La sesión y la mesa sí deben haberse actualizado.
      expect(prismaMock.table_sessions.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.tables.update).toHaveBeenCalledTimes(1);
    });

    it('does NOT touch the order state when the order is in "created" (option 2)', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      expect(prismaMock.orders.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the order state when the order is in "pending_payment" (option 2)', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      expect(prismaMock.orders.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the order state when the order is in "processing" (KDS in flight)', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the order state when it is already "finished" (idempotency)', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });

    it('does NOT fail when the session has no order_id', async () => {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession({ order_id: undefined as any }),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await expect(service.closeSession(77)).resolves.toBeDefined();

      // orders.findUnique should NOT have been queried.
      expect(prismaMock.orders.findUnique).not.toHaveBeenCalled();
      // orders.update should NOT have been called.
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });

    it('the order remains payable AFTER closeSession (regression guard)', async () => {
      // ─── Verifica el comentario del docblock ─────────────────────────
      // "The order is left in draft — it is paid via the normal payments
      // flow (which can happen with the session closed, e.g. someone pays
      // the check after stepping out of the restaurant)."
      //
      // Después de closeSession la orden debe seguir siendo cobrable. Como
      // aquí solo cerramos la sesión sin tocar la orden, una llamada
      // posterior al flujo de pagos (PaymentsService.processPosPayment,
      // OrderFlowService.transition, etc.) puede actuar sobre ella sin que
      // este método la haya dejado en un estado terminal.
      //
      // Spy sobre el Logger interno del service: como `logger` es privado
      // usamos bracket-access tipado a `any`. La aserción del log es
      // secundaria — las fuertes (`orders.*` no se llaman) ya garantizan
      // el invariante. Esto añade una capa de auditoría para grep post-mortem.
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValue(
        mockSession(),
      );
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      await service.closeSession(77);

      // El contrato: no se escribió NADA en orders durante el close.
      expect(prismaMock.orders.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      // El log debe mencionar explícitamente que el estado NO cambió.
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('order state unchanged'),
      );

      logSpy.mockRestore();
    });

    it('is idempotent: a second close on the same session is a no-op', async () => {
      // First close: `findOne` se llama DOS veces — al inicio (línea 1030) y
      // al final antes de retornar (línea 1060). Ambas con la sesión abierta.
      (prismaMock.table_sessions.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockSession())
        .mockResolvedValueOnce(mockSession());
      // Second close: `findOne` se llama UNA vez (la sesión ya viene cerrada
      // → short-circuit antes de la segunda llamada del final).
      (prismaMock.table_sessions.findFirst as jest.Mock).mockResolvedValueOnce(
        mockSession({ closed_at: new Date() }),
      );

      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});

      // First close — la transacción corre, ningún write a orders.
      await service.closeSession(77);
      expect(prismaMock.orders.update).toHaveBeenCalledTimes(0);
      expect(prismaMock.table_sessions.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.tables.update).toHaveBeenCalledTimes(1);

      // Second close — short-circuit en `if (session.closed_at)`. Ningún write.
      await service.closeSession(77);
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      // Los counters siguen en los valores del primer close (no se duplican).
      expect(prismaMock.table_sessions.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.tables.update).toHaveBeenCalledTimes(1);
    });
  });
});
