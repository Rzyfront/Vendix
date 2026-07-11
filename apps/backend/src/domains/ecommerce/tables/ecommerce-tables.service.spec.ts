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

    service = new EcommerceTablesService(
      prismaMock as any,
      tablesService as any,
      tableSessionsService as any,
      settingsService as any,
      kitchenFireService as any,
      menuAvailabilityChecker as any,
      sseService as any,
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
    it('does NOT open a session and notifies staff via SSE', async () => {
      mockTableFound();
      setBehavior('require_staff');

      const result = await service.resolveByToken(TOKEN);

      expect(tableSessionsService.openTableSessionPublic).not.toHaveBeenCalled();
      expect(result.session_id).toBeUndefined();
      expect(sseService.push).toHaveBeenCalledWith(
        STORE_ID,
        expect.objectContaining({
          type: 'qr_table_scan',
          data: expect.objectContaining({ table_id: TABLE_ID }),
        }),
      );
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