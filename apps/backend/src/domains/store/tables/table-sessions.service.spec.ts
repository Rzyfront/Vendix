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
      product_variants: {
        findMany: jest.fn().mockResolvedValue([]),
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

    it('rejects a line without variant on ANY product with variants (not just prepared)', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: { state: 'draft', order_items: [] },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: 60,
          name: 'Camiseta',
          base_price: 50000,
          is_sellable: true,
          product_type: 'physical',
          track_inventory: false,
          product_variants: [{ id: 61 }],
        },
      ]);

      await expect(
        service.addItems(1, { items: [{ product_id: 60, quantity: 1 }] } as any),
      ).rejects.toMatchObject({ errorCode: 'PRODUCT_VARIANT_REQUIRED' });
      expect(prismaMock.order_items.create).not.toHaveBeenCalled();
    });

    it('prices the line with the VARIANT value (override), not the base price', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: { state: 'draft', order_items: [] },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: 60,
          name: 'Camiseta',
          base_price: 50000,
          is_sellable: true,
          product_type: 'physical',
          track_inventory: false,
          product_variants: [{ id: 61 }],
        },
      ]);
      prismaMock.product_variants.findMany.mockResolvedValue([
        {
          id: 61,
          product_id: 60,
          price_override: new Prisma.Decimal(65000),
          is_on_sale: false,
          sale_price: null,
        },
      ]);
      prismaMock.order_items.findMany.mockResolvedValue([]);
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});

      await service.addItems(1, {
        items: [{ product_id: 60, product_variant_id: 61, quantity: 2 }],
      } as any);
      expect(prismaMock.order_items.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            product_variant_id: 61,
            unit_price: new Prisma.Decimal(65000),
            total_price: new Prisma.Decimal(130000),
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

  describe('transferSession (cambio de mesa)', () => {
    const SRC = 5;
    const DST = 7;
    const SRC_SESSION_ID = 77;
    const DST_SESSION_ID = 88;
    const SRC_ORDER_ID = 9001;
    const DST_ORDER_ID = 9002;

    const tableRow = (id: number, name: string, status: string) => ({
      id,
      store_id: STORE_ID,
      name,
      zone: null,
      capacity: 4,
      status,
      pos_x: null,
      pos_y: null,
      public_token: `tok-${id}`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const sessionRow = (id: number, tableId: number, orderId: number) => ({
      id,
      store_id: STORE_ID,
      table_id: tableId,
      order_id: orderId,
      opened_by: USER_ID,
      opened_at: new Date(),
      closed_at: null,
      paid_at: null,
      guest_count: 2,
    });
    const sessionView = (id: number, tableId: number, orderId: number) => ({
      ...sessionRow(id, tableId, orderId),
      order: {
        id: orderId,
        state: 'draft',
        grand_total: new Prisma.Decimal(50000),
        subtotal_amount: new Prisma.Decimal(50000),
        tax_amount: new Prisma.Decimal(0),
        discount_amount: new Prisma.Decimal(0),
        customer_alias: null,
        users: null,
        order_items: [],
      },
      table: {
        id: tableId,
        name: `Mesa ${tableId}`,
        zone: null,
        status: 'occupied',
        table_waiters: [],
      },
    });

    const ssePush = () =>
      (service as any).notificationsSseService.push as jest.Mock;

    beforeEach(() => {
      prismaMock.kitchen_tickets = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      prismaMock.table_sessions.update.mockResolvedValue({});
      prismaMock.tables.update.mockResolvedValue({});
    });

    function mockTablesForTransfer(opts: {
      srcSession: boolean;
      dstSession: boolean;
      dstStatus: string;
    }) {
      (tablesService.getById as jest.Mock).mockImplementation(
        async (id: number) => {
          if (id === SRC) return tableRow(SRC, 'Mesa 5', 'occupied');
          if (id === DST) return tableRow(DST, 'Mesa 7', opts.dstStatus);
          throw new Error(`unexpected table ${id}`);
        },
      );
      (tablesService.getActiveSession as jest.Mock).mockImplementation(
        async (id: number) => {
          if (id === SRC)
            return opts.srcSession
              ? sessionRow(SRC_SESSION_ID, SRC, SRC_ORDER_ID)
              : null;
          if (id === DST)
            return opts.dstSession
              ? sessionRow(DST_SESSION_ID, DST, DST_ORDER_ID)
              : null;
          return null;
        },
      );
    }

    /**
     * `findFirst` backs BOTH the in-tx re-reads (no `include`) and the
     * post-commit `findOne` views (`include` present). Dispatch on that.
     */
    function mockTransferReads(opts: {
      dstSession: boolean;
      raceOnTarget?: any;
      /**
       * Fila abierta que quedó sobre la mesa ORIGEN DESPUÉS de mover la
       * sesión trasladada (llegó por un swap concurrente). La rama de
       * traslado la consulta antes de liberar la mesa.
       */
      openOnSource?: any;
      /**
       * Re-lecturas in-tx. Se leen con `in` y no con `??` para poder
       * simular explícitamente `null` (fila borrada / no visible).
       */
      freshSrc?: any;
      freshDst?: any;
    }) {
      (prismaMock.table_sessions.findFirst as jest.Mock).mockImplementation(
        async (args: any) => {
          if (args?.include) {
            if (args?.where?.id === SRC_SESSION_ID)
              return sessionView(SRC_SESSION_ID, DST, SRC_ORDER_ID);
            if (args?.where?.id === DST_SESSION_ID)
              return sessionView(DST_SESSION_ID, SRC, DST_ORDER_ID);
            return null;
          }
          if (args?.where?.id === SRC_SESSION_ID)
            return 'freshSrc' in opts
              ? opts.freshSrc
              : sessionRow(SRC_SESSION_ID, SRC, SRC_ORDER_ID);
          if (args?.where?.id === DST_SESSION_ID)
            return 'freshDst' in opts
              ? opts.freshDst
              : opts.dstSession
                ? sessionRow(DST_SESSION_ID, DST, DST_ORDER_ID)
                : null;
          if (
            args?.where?.table_id === DST &&
            args?.where?.closed_at === null
          )
            return opts.raceOnTarget ?? null;
          if (
            args?.where?.table_id === SRC &&
            args?.where?.closed_at === null
          )
            return opts.openOnSource ?? null;
          return null;
        },
      );
    }

    it('moves the session to an empty target (transfer)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({ dstSession: false });

      const result = await service.transferSession(SRC, DST);

      expect(result.mode).toBe('transfer');
      expect(result.source_session.id).toBe(SRC_SESSION_ID);
      expect(result.source_session.table_id).toBe(DST);
      expect(result.target_session).toBeNull();
      // Session row re-pointed, id stable.
      expect(prismaMock.table_sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC_SESSION_ID },
          data: expect.objectContaining({ table_id: DST }),
        }),
      );
      // KDS tickets re-stamped by order.
      expect(prismaMock.kitchen_tickets.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ order_id: SRC_ORDER_ID }),
          data: expect.objectContaining({ table_id: DST }),
        }),
      );
      // Statuses flip only in transfer mode. La mesa ORIGEN queda en
      // `cleaning` (mismo estado que deja `closeSession`), NUNCA en
      // `available`: saltarse el reset dejaría sentar un grupo nuevo en una
      // mesa sucia.
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'cleaning' }),
        }),
      );
      expect(prismaMock.tables.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'available' }),
        }),
      );
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DST },
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
      // Orders / inventory untouched (anti-double-discount).
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      expect(prismaMock.order_items.create).not.toHaveBeenCalled();
      // Post-commit emits: session_moved + one table_status_changed/table.
      const types = ssePush().mock.calls.map((c: any) => c[1]?.type);
      expect(types).toContain('session_moved');
      expect(types.filter((t: string) => t === 'table_status_changed'))
        .toHaveLength(2);
    });

    it('swaps both sessions when the target is occupied (swap)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: true,
        dstStatus: 'occupied',
      });
      mockTransferReads({ dstSession: true });

      const result = await service.transferSession(SRC, DST);

      expect(result.mode).toBe('swap');
      expect(result.source_session.id).toBe(SRC_SESSION_ID);
      expect(result.source_session.table_id).toBe(DST);
      expect(result.target_session!.id).toBe(DST_SESSION_ID);
      expect(result.target_session!.table_id).toBe(SRC);
      // Ordered 3-step swap: transient close, move target, move+reopen source.
      const sessionWrites = (
        prismaMock.table_sessions.update as jest.Mock
      ).mock.calls.map((c: any) => c[0]);
      expect(sessionWrites).toHaveLength(3);
      expect(sessionWrites[0]).toEqual(
        expect.objectContaining({
          where: { id: SRC_SESSION_ID },
          data: expect.objectContaining({ closed_at: expect.any(Date) }),
        }),
      );
      expect(sessionWrites[0].data).not.toHaveProperty('table_id');
      expect(sessionWrites[1]).toEqual(
        expect.objectContaining({
          where: { id: DST_SESSION_ID },
          data: expect.objectContaining({ table_id: SRC }),
        }),
      );
      expect(sessionWrites[2]).toEqual(
        expect.objectContaining({
          where: { id: SRC_SESSION_ID },
          data: expect.objectContaining({ table_id: DST, closed_at: null }),
        }),
      );
      // Both orders' KDS tickets re-stamped to the opposite table.
      expect(prismaMock.kitchen_tickets.updateMany).toHaveBeenCalledTimes(2);
      expect(prismaMock.kitchen_tickets.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ order_id: SRC_ORDER_ID }),
          data: expect.objectContaining({ table_id: DST }),
        }),
      );
      expect(prismaMock.kitchen_tickets.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ order_id: DST_ORDER_ID }),
          data: expect.objectContaining({ table_id: SRC }),
        }),
      );
      // Both tables stay occupied.
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DST },
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      const types = ssePush().mock.calls.map((c: any) => c[1]?.type);
      expect(types).toContain('session_moved');
    });

    it('rejects when the source has no open session', async () => {
      mockTablesForTransfer({
        srcSession: false,
        dstSession: false,
        dstStatus: 'available',
      });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_SESSION_NOT_FOUND',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('rejects a reserved target', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'reserved',
      });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_INVALID_STATUS',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('rejects when source and target are the same table', async () => {
      await expect(service.transferSession(SRC, SRC)).rejects.toMatchObject({
        errorCode: 'SYS_INVALID_FIELD_VALUE_001',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('rejects when the target is taken mid-flight (race guard)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({
        dstSession: false,
        raceOnTarget: sessionRow(999, DST, 1234),
      });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_SESSION_ALREADY_OPEN',
      });
      expect(prismaMock.table_sessions.update).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // F1 — re-lectura TOCTOU de la sesión ORIGEN en la rama de TRASLADO.
    // `sourceSession` se lee FUERA de la transacción; sin re-leerla dentro
    // el traslado escribe a ciegas. Estos tres tests fallan si se quita la
    // re-lectura (el servicio resolvería en vez de rechazar).
    // ------------------------------------------------------------------
    it('transfer: rejects when the source check was closed mid-flight (TOCTOU)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({
        dstSession: false,
        freshSrc: {
          ...sessionRow(SRC_SESSION_ID, SRC, SRC_ORDER_ID),
          closed_at: new Date(),
        },
      });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_SESSION_ALREADY_OPEN',
      });
      // Nada se escribió: ni se re-apuntó una sesión CERRADA al destino ni
      // se marcó el destino `occupied` sin cuenta abierta (mesa fantasma).
      expect(prismaMock.table_sessions.update).not.toHaveBeenCalled();
      expect(prismaMock.tables.update).not.toHaveBeenCalled();
      expect(prismaMock.kitchen_tickets.updateMany).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('transfer: rejects when the source check already moved to another table (TOCTOU)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      // Un swap concurrente ya movió la cuenta de SRC a la mesa 999.
      mockTransferReads({
        dstSession: false,
        freshSrc: sessionRow(SRC_SESSION_ID, 999, SRC_ORDER_ID),
      });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_SESSION_ALREADY_OPEN',
      });
      expect(prismaMock.table_sessions.update).not.toHaveBeenCalled();
      // Clave: la mesa ORIGEN no se tocó. Liberarla habría huérfanado la
      // cuenta que el swap dejó encima de ella.
      expect(prismaMock.tables.update).not.toHaveBeenCalled();
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('transfer: rejects when the source session row is gone mid-flight (TOCTOU)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({ dstSession: false, freshSrc: null });

      await expect(service.transferSession(SRC, DST)).rejects.toMatchObject({
        errorCode: 'TABLE_SESSION_ALREADY_OPEN',
      });
      expect(prismaMock.table_sessions.update).not.toHaveBeenCalled();
      expect(prismaMock.tables.update).not.toHaveBeenCalled();
    });

    it('transfer: keeps the source table occupied when another open check landed on it', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      // La sesión origen sigue válida (pasa el TOCTOU), pero al momento de
      // liberar la mesa un swap concurrente ya dejó OTRA cuenta abierta
      // sobre SRC. Liberar la mesa la huérfanaría.
      mockTransferReads({
        dstSession: false,
        openOnSource: sessionRow(555, SRC, 7777),
      });

      const result = await service.transferSession(SRC, DST);

      expect(result.mode).toBe('transfer');
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
      expect(prismaMock.tables.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'cleaning' }),
        }),
      );
      expect(prismaMock.tables.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SRC },
          data: expect.objectContaining({ status: 'available' }),
        }),
      );
      // El SSE anuncia el MISMO estado que quedó en base de datos.
      const srcStatusPush = ssePush().mock.calls.find(
        (c: any) =>
          c[1]?.type === 'table_status_changed' && c[1]?.data?.table_id === SRC,
      );
      expect(srcStatusPush![1].data.status).toBe('occupied');
    });

    it('transfer: announces `cleaning` for the source table over SSE (F3)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({ dstSession: false });

      await service.transferSession(SRC, DST);

      const srcStatusPush = ssePush().mock.calls.find(
        (c: any) =>
          c[1]?.type === 'table_status_changed' && c[1]?.data?.table_id === SRC,
      );
      expect(srcStatusPush![1].data.status).toBe('cleaning');
      const dstStatusPush = ssePush().mock.calls.find(
        (c: any) =>
          c[1]?.type === 'table_status_changed' && c[1]?.data?.table_id === DST,
      );
      expect(dstStatusPush![1].data.status).toBe('occupied');
    });

    // ------------------------------------------------------------------
    // F2 — el índice único parcial `table_sessions_one_open_per_table` es
    // la última defensa detrás de los guards check-then-act. Su P2002 debe
    // salir como 409 tipado, no como 500 crudo (el filtro global no
    // traduce errores de Prisma).
    // ------------------------------------------------------------------
    it('maps the partial-unique P2002 to TABLE_SESSION_ALREADY_OPEN instead of a raw 500', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({ dstSession: false });
      // Los dos traslados concurrentes vieron `raced === null`; el perdedor
      // choca contra el índice al escribir.
      prismaMock.table_sessions.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`table_id`)',
          {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['table_id'] },
          },
        ),
      );

      const err = await service
        .transferSession(SRC, DST)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err).toMatchObject({ errorCode: 'TABLE_SESSION_ALREADY_OPEN' });
      // Nada de SSE: la transacción no llegó a commitear.
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('maps a Prisma write-conflict/deadlock (P2034) to a retryable 409', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: true,
        dstStatus: 'occupied',
      });
      mockTransferReads({ dstSession: true });
      prismaMock.table_sessions.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Transaction failed due to a write conflict or a deadlock',
          { code: 'P2034', clientVersion: 'test' },
        ),
      );

      const err = await service
        .transferSession(SRC, DST)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err).toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
      expect(ssePush()).not.toHaveBeenCalled();
    });

    it('rethrows unrelated Prisma errors untouched (no blanket swallow)', async () => {
      mockTablesForTransfer({
        srcSession: true,
        dstSession: false,
        dstStatus: 'available',
      });
      mockTransferReads({ dstSession: false });
      const raw = new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2025',
        clientVersion: 'test',
      });
      prismaMock.table_sessions.update.mockRejectedValueOnce(raw);

      await expect(service.transferSession(SRC, DST)).rejects.toBe(raw);
    });
  });
});
