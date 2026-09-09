import { Test, TestingModule } from '@nestjs/testing';
import { EcommerceTablesService } from './ecommerce-tables.service';
import { EcommerceTablesController } from './ecommerce-tables.controller';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';
import { TablesService } from '../../store/tables/tables.service';
import { TableSessionsService } from '../../store/tables/table-sessions.service';
import { SettingsService } from '../../store/settings/settings.service';
import { KitchenFireService } from '../../store/kitchen-fire/kitchen-fire.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';

describe('EcommerceTablesService — resolveByToken (QR-por-mesa)', () => {
  let service: EcommerceTablesService;
  let prismaMock: any;
  let tablesService: any;
  let tableSessionsService: any;
  let settingsService: any;
  let kitchenFireService: any;
  let menuAvailabilityChecker: any;
  let sseService: any;
  let notificationsService: any;
  let context: any;

  const STORE_ID = 100;
  const TABLE_ID = 5;
  const TOKEN = 'abc-123-xyz';
  const SESSION_ID = 77;
  const ORDER_ID = 901;

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: undefined,
      is_super_admin: false,
    };

    prismaMock = {
      tables: {
        findFirst: jest.fn(),
      },
      store_settings: {
        findUnique: jest.fn(),
      },
      table_sessions: {
        update: jest.fn(),
        // HIGH-6 — lectura de la sesión que el cliente creía tener, para
        // decidir si se movió a otra mesa. Por defecto "no existe abierta".
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context);
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID);
    jest
      .spyOn(RequestContextService, 'getUserId')
      .mockReturnValue(undefined);

    tablesService = {
      update: jest.fn(),
      getActiveSession: jest.fn(),
      // Step 2 (QR-mesa): per-table waiter resolution used by
      // dispatchStaffNotification. Default = no waiters → broadcast fallback.
      getAssignedWaiterUserIds: jest.fn().mockResolvedValue([]),
    };

    tableSessionsService = {
      openTableSessionPublic: jest.fn(),
      addItems: jest.fn(),
    };

    settingsService = {};

    kitchenFireService = {};

    menuAvailabilityChecker = {
      getBlockedProductIds: jest.fn().mockResolvedValue(new Set()),
    };

    sseService = {
      push: jest.fn(),
    };

    // Step 3 (QR-mesa): staff notifications now route per-user via
    // sendToUser (assigned waiters) with a createAndBroadcast fallback.
    notificationsService = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
      createAndBroadcast: jest.fn().mockResolvedValue(undefined),
    };

    // Payment / infra deps — not exercised by resolveByToken, mocked as
    // empty stubs so the 14-arg constructor is satisfied.
    // `customersService` entró al constructor (posición 5) sin que este spec
    // se actualizara: la suite entera dejó de compilar (TS2554) y por tanto
    // de correr. Se repone aquí como stub vacío — `resolveByToken` no lo usa.
    const customersService = {};
    const storePaymentMethodsService = {};
    const paymentEncryptionService = {};
    const wompiClientFactory = {};
    const s3Service = { signUrl: jest.fn() };
    const redis = {};

    service = new EcommerceTablesService(
      prismaMock as any,
      tablesService as any,
      tableSessionsService as any,
      settingsService as any,
      customersService as any,
      kitchenFireService as any,
      menuAvailabilityChecker as any,
      sseService as any,
      notificationsService as any,
      storePaymentMethodsService as any,
      paymentEncryptionService as any,
      wompiClientFactory as any,
      s3Service as any,
      redis as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // Helper: configure the store_settings row to return a given behavior.
  const setBehavior = (
    behavior: string,
    auto_fire = false,
  ) => {
    prismaMock.store_settings.findUnique.mockResolvedValue({
      settings: { restaurant: { qr_scan_behavior: behavior, qr_auto_fire: auto_fire } },
    });
  };

  const mockTableFound = () => {
    prismaMock.tables.findFirst.mockResolvedValue({
      id: TABLE_ID,
      name: 'Mesa 1',
      status: 'available',
    });
  };

  describe('menu_only', () => {
    it('returns context without session_id and does not mutate table', async () => {
      mockTableFound();
      setBehavior('menu_only');

      const result = await service.resolveByToken(TOKEN);

      expect(result.table).toEqual({ id: TABLE_ID, name: 'Mesa 1' });
      expect(result.behavior).toBe('menu_only');
      expect(result.auto_fire).toBe(false);
      expect(result.session_id).toBeUndefined();
      expect(tablesService.update).not.toHaveBeenCalled();
      expect(tableSessionsService.openTableSessionPublic).not.toHaveBeenCalled();
    });
  });

  describe('mark_occupied', () => {
    it('calls tablesService.update with status=occupied', async () => {
      mockTableFound();
      setBehavior('mark_occupied');

      const result = await service.resolveByToken(TOKEN);

      expect(tablesService.update).toHaveBeenCalledWith(TABLE_ID, {
        status: 'occupied',
      });
      expect(result.session_id).toBeUndefined();
      expect(tableSessionsService.openTableSessionPublic).not.toHaveBeenCalled();
    });

    it('skips update when table is already occupied (idempotent)', async () => {
      prismaMock.tables.findFirst.mockResolvedValue({
        id: TABLE_ID,
        name: 'Mesa 1',
        status: 'occupied',
      });
      setBehavior('mark_occupied');

      const result = await service.resolveByToken(TOKEN);

      expect(tablesService.update).not.toHaveBeenCalled();
      expect(result.session_id).toBeUndefined();
    });
  });

  describe('open_tab', () => {
    it('opens a public session and returns session_id', async () => {
      mockTableFound();
      setBehavior('open_tab');
      tableSessionsService.openTableSessionPublic.mockResolvedValue({
        id: SESSION_ID,
        order_id: ORDER_ID,
        opened_by: null,
      });

      const result = await service.resolveByToken(TOKEN);

      expect(tableSessionsService.openTableSessionPublic).toHaveBeenCalledWith(
        TABLE_ID,
      );
      expect(result.session_id).toBe(SESSION_ID);
    });
  });

  describe('require_staff', () => {
    it('does NOT open a session and broadcasts a persisted notification when no waiters are assigned', async () => {
      mockTableFound();
      setBehavior('require_staff');

      const result = await service.resolveByToken(TOKEN);
      // notifyStaffTableScan is fire-and-forget (`void dispatch...`); flush
      // the micro/macrotask queue so the dispatch completes before asserting.
      await new Promise((resolve) => setImmediate(resolve));

      expect(tableSessionsService.openTableSessionPublic).not.toHaveBeenCalled();
      expect(result.session_id).toBeUndefined();
      // No assigned waiters → store-wide fallback (createAndBroadcast) with
      // the qr_table_scan type and public_token baked into the payload (Step 4b).
      expect(notificationsService.createAndBroadcast).toHaveBeenCalledWith(
        STORE_ID,
        'qr_table_scan',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          table_id: TABLE_ID,
          public_token: TOKEN,
        }),
      );
      expect(notificationsService.sendToUser).not.toHaveBeenCalled();
    });

    it('routes per-user via sendToUser when the table has assigned waiters', async () => {
      mockTableFound();
      setBehavior('require_staff');
      tablesService.getAssignedWaiterUserIds.mockResolvedValue([42]);

      await service.resolveByToken(TOKEN);
      await new Promise((resolve) => setImmediate(resolve));

      expect(notificationsService.sendToUser).toHaveBeenCalledWith(
        STORE_ID,
        42,
        'qr_table_scan',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ table_id: TABLE_ID, public_token: TOKEN }),
      );
      expect(notificationsService.createAndBroadcast).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('throws TABLE_NOT_FOUND when token does not resolve', async () => {
      prismaMock.tables.findFirst.mockResolvedValue(null);
      setBehavior('menu_only');

      await expect(service.resolveByToken('unknown')).rejects.toThrow(
        VendixHttpException,
      );
    });

    it('throws when token is empty', async () => {
      await expect(service.resolveByToken('')).rejects.toThrow(
        VendixHttpException,
      );
    });

    it('defaults to menu_only when restaurant block is absent', async () => {
      mockTableFound();
      prismaMock.store_settings.findUnique.mockResolvedValue({
        settings: {},
      });

      const result = await service.resolveByToken(TOKEN);

      expect(result.behavior).toBe('menu_only');
      expect(result.session_id).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // HIGH-6 — cambio de mesa: defensa en frío de `resolveByToken`.
  //
  // El `public_token` está pegado a la MESA, no a la sesión. Tras un
  // traslado/intercambio, el comensal que recarga la página trae en su
  // `localStorage` una sesión que ya no vive en esta mesa. El parámetro
  // OPCIONAL `knownSessionId` deja que el servidor lo detecte y responda un
  // marcador; su AUSENCIA debe preservar el contrato viejo intacto.
  // ------------------------------------------------------------------
  describe('session_moved (HIGH-6 — defensa en frío del cambio de mesa)', () => {
    const OTHER_TABLE_ID = TABLE_ID + 1;

    it('marca session_moved cuando la sesión conocida sigue abierta en OTRA mesa', async () => {
      mockTableFound();
      setBehavior('open_tab');
      tableSessionsService.openTableSessionPublic.mockResolvedValue({
        id: SESSION_ID,
      });
      tablesService.getActiveSession.mockResolvedValue(null);
      // La sesión que el cliente creía tener sigue viva, pero en otra mesa.
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        table_id: OTHER_TABLE_ID,
      });

      const result = await service.resolveByToken(TOKEN, 4242);

      expect(prismaMock.table_sessions.findFirst).toHaveBeenCalledWith({
        where: { id: 4242, closed_at: null },
        select: { table_id: true },
      });
      expect(result.session_moved).toBe(true);
    });

    it('NO marca session_moved cuando la sesión conocida es la activa de esta mesa', async () => {
      mockTableFound();
      setBehavior('mark_occupied');
      tablesService.getActiveSession.mockResolvedValue({
        id: SESSION_ID,
        order_id: ORDER_ID,
      });

      const result = await service.resolveByToken(TOKEN, SESSION_ID);

      // Coinciden: ni siquiera se consulta la tabla de sesiones.
      expect(prismaMock.table_sessions.findFirst).not.toHaveBeenCalled();
      expect(result.session_moved).toBeUndefined();
    });

    it('NO marca session_moved cuando la sesión conocida ya se cerró (ese carril es session_closed)', async () => {
      mockTableFound();
      setBehavior('mark_occupied');
      tablesService.getActiveSession.mockResolvedValue(null);
      // `closed_at: null` no matchea → la sesión conocida está cerrada.
      prismaMock.table_sessions.findFirst.mockResolvedValue(null);

      const result = await service.resolveByToken(TOKEN, 4242);

      expect(result.session_moved).toBeUndefined();
    });

    it('omite la consulta y el marcador cuando el cliente NO manda session_id (cliente viejo)', async () => {
      mockTableFound();
      setBehavior('mark_occupied');
      tablesService.getActiveSession.mockResolvedValue(null);

      const result = await service.resolveByToken(TOKEN);

      expect(prismaMock.table_sessions.findFirst).not.toHaveBeenCalled();
      expect(result.session_moved).toBeUndefined();
      expect(Object.keys(result)).not.toContain('session_moved');
    });
  });
});

// ====================================================================
// HIGH-6 — filtro y proyección del stream del comensal para
// `session_moved`. Se prueba el controlador directamente (sólo tiene dos
// dependencias) porque `matchesDiner` / `projectForDiner` son privados y
// no hay otra superficie desde la que sean alcanzables.
// ====================================================================
describe('EcommerceTablesController — session_moved en el stream del comensal', () => {
  const SOURCE_TABLE_ID = 5;
  const TARGET_TABLE_ID = 9;
  const SOURCE_SESSION_ID = 77;
  const TARGET_SESSION_ID = 88;

  let controller: EcommerceTablesController;

  /** Evento crudo tal como lo empuja `TableSessionsService.emitSessionMoved`. */
  const swapEvent = () => ({
    id: 0,
    type: 'session_moved',
    title: 'Cuenta trasladada',
    body: 'Dos mesas intercambiaron sus cuentas',
    data: {
      mode: 'swap',
      source_table_id: SOURCE_TABLE_ID,
      target_table_id: TARGET_TABLE_ID,
      source_session_id: SOURCE_SESSION_ID,
      target_session_id: TARGET_SESSION_ID,
      source_order_id: 901,
      target_order_id: 902,
    },
    created_at: new Date().toISOString(),
  });

  const match = (
    ev: Record<string, unknown>,
    binding: { table_id: number; session_id: number | null; order_id: number | null } | null,
  ): boolean =>
    (controller as any).matchesDiner(ev, binding) as boolean;

  beforeEach(() => {
    controller = new EcommerceTablesController({} as any, {} as any);
  });

  describe('matchesDiner (default-deny)', () => {
    it('ACEPTA cuando el binding coincide por session_id de ORIGEN', () => {
      expect(
        match(swapEvent(), {
          table_id: SOURCE_TABLE_ID,
          session_id: SOURCE_SESSION_ID,
          order_id: 901,
        }),
      ).toBe(true);
    });

    it('ACEPTA cuando el binding coincide por session_id de DESTINO (grupo desplazado en un swap)', () => {
      expect(
        match(swapEvent(), {
          table_id: TARGET_TABLE_ID,
          session_id: TARGET_SESSION_ID,
          order_id: 902,
        }),
      ).toBe(true);
    });

    it('ACEPTA cuando sólo coincide por table_id con session_id === null (ventana pre-sesión)', () => {
      expect(
        match(swapEvent(), {
          table_id: TARGET_TABLE_ID,
          session_id: null,
          order_id: null,
        }),
      ).toBe(true);
    });

    it('RECHAZA cuando no coincide ni por sesión ni por mesa (otro comensal del salón)', () => {
      expect(
        match(swapEvent(), {
          table_id: 999,
          session_id: 12345,
          order_id: 777,
        }),
      ).toBe(false);
    });

    it('RECHAZA a un comensal pre-sesión de una mesa ajena — null NO debe casar con target_session_id null', () => {
      const transferEvent = swapEvent();
      // Modo `transfer`: la mesa destino estaba libre, así que no hay sesión
      // destino. Un `null === null` ingenuo colaría a todo el salón.
      (transferEvent.data as any).mode = 'transfer';
      (transferEvent.data as any).target_session_id = null;
      (transferEvent.data as any).target_order_id = null;

      expect(
        match(transferEvent, {
          table_id: 999,
          session_id: null,
          order_id: null,
        }),
      ).toBe(false);
    });

    it('RECHAZA cuando el evento llega sin data', () => {
      expect(
        match(
          { type: 'session_moved' },
          { table_id: SOURCE_TABLE_ID, session_id: SOURCE_SESSION_ID, order_id: 901 },
        ),
      ).toBe(false);
    });
  });

  describe('projectForDiner (mínimo privilegio)', () => {
    const project = (ev: Record<string, unknown>): Record<string, unknown> =>
      (controller as any).projectForDiner(ev) as Record<string, unknown>;

    it('NO filtra los order_id ni los session_id del otro grupo', () => {
      const projected = project(swapEvent());

      // Ancla primero el tipo: sin la rama dedicada, `projectForDiner` cae al
      // fallback KDS (`kitchen.update`) y las aserciones de abajo pasarían en
      // vacío sobre un payload que ni siquiera es este evento.
      expect(projected.type).toBe('session_moved');
      expect(projected).not.toHaveProperty('source_order_id');
      expect(projected).not.toHaveProperty('target_order_id');
      expect(projected).not.toHaveProperty('source_session_id');
      expect(projected).not.toHaveProperty('target_session_id');
      // Ni anidados bajo `data` — la proyección aplana a nivel raíz.
      expect(projected).not.toHaveProperty('data');
      expect(JSON.stringify(projected)).not.toContain('901');
      expect(JSON.stringify(projected)).not.toContain('902');
    });

    it('proyecta sólo type + mode + las dos mesas + ts', () => {
      const projected = project(swapEvent());

      expect(Object.keys(projected).sort()).toEqual(
        ['mode', 'source_table_id', 'target_table_id', 'ts', 'type'].sort(),
      );
      expect(projected.type).toBe('session_moved');
      expect(projected.mode).toBe('swap');
      expect(projected.source_table_id).toBe(SOURCE_TABLE_ID);
      expect(projected.target_table_id).toBe(TARGET_TABLE_ID);
    });
  });
});