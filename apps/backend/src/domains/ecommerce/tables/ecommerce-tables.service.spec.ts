import { Test, TestingModule } from '@nestjs/testing';
import { EcommerceTablesService } from './ecommerce-tables.service';
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
    // empty stubs so the 13-arg constructor is satisfied.
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
});