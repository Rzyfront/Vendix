import { SettingsService } from './settings.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { SessionsService } from '../cash-registers/sessions/sessions.service';

/**
 * QUI-560 — regresión del guard de transición de settings.
 *
 * El bug original: `PATCH /store/settings` apagaba `pos.cash_register.enabled`
 * con sesiones de caja abiertas y devolvía 200, dejando la sesión viva pero
 * ciega (cuatro servicios omiten la escritura en `cash_register_movements`
 * cuando el flag está apagado). Los tres caminos de escritura compartían el
 * hueco, así que los tres se prueban aquí: quitar
 * `assertSettingsTransitionAllowed` debe romper exactamente los tres casos
 * "bloquea".
 */

type MockStorePrismaService = {
  store_settings: { findUnique: jest.Mock; upsert: jest.Mock };
  default_templates: { findFirst: jest.Mock };
  stores: { findUnique: jest.Mock; update: jest.Mock };
} & Partial<StorePrismaService>;

const STORE_ID = 10;
const USER_ID = 15;

/** Settings persistidos con la caja ENCENDIDA (estado de partida del bug). */
const STORED_WITH_CASH_REGISTER_ON = {
  pos: { cash_register: { enabled: true } },
};

const OPEN_SESSIONS = {
  count: 1,
  registers: [{ id: 19, name: 'Caja Principal' }],
};

const NO_OPEN_SESSIONS = { count: 0, registers: [] as { id: number; name: string }[] };

describe('SettingsService — guard de transición de caja (QUI-560)', () => {
  let service: SettingsService;
  let prisma: MockStorePrismaService;
  let sessionsService: { countOpenSessions: jest.Mock };
  let auditService: { logUpdate: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);

    prisma = {
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          store_id: STORE_ID,
          settings: STORED_WITH_CASH_REGISTER_ON,
        }),
        upsert: jest.fn().mockImplementation(({ update }: any) => ({
          store_id: STORE_ID,
          settings: update?.settings ?? {},
        })),
      },
      default_templates: { findFirst: jest.fn() },
      stores: { findUnique: jest.fn(), update: jest.fn() },
    } as MockStorePrismaService;

    sessionsService = { countOpenSessions: jest.fn() };
    auditService = { logUpdate: jest.fn().mockResolvedValue(undefined) };

    service = new SettingsService(
      prisma as unknown as StorePrismaService,
      {} as any, // organizationPrisma
      {} as any, // globalPrisma
      {} as any, // s3Service
      {} as any, // s3PathHelper
      auditService as any,
      {} as any, // migrator
      {} as any, // fiscalScope
      sessionsService as unknown as SessionsService,
    );
  });

  // ---------------------------------------------------------------- updateSettings

  describe('updateSettings', () => {
    const disablePayload = { pos: { cash_register: { enabled: false } } };

    it('bloquea el apagado con sesiones abiertas y NO persiste', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(OPEN_SESSIONS);

      await expect(service.updateSettings(disablePayload)).rejects.toThrow(
        VendixHttpException,
      );
      await expect(
        service.updateSettings(disablePayload),
      ).rejects.toMatchObject({ errorCode: 'CASH_REGISTER_DISABLE_001' });

      expect(prisma.store_settings.upsert).not.toHaveBeenCalled();
    });

    it('permite el apagado cuando no hay sesiones abiertas', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(NO_OPEN_SESSIONS);

      await service.updateSettings(disablePayload);

      expect(prisma.store_settings.upsert).toHaveBeenCalledTimes(1);
      const persisted = (prisma.store_settings.upsert as jest.Mock).mock
        .calls[0][0].update.settings;
      expect(persisted.pos.cash_register.enabled).toBe(false);
    });

    it('nunca consulta sesiones cuando la transición no apaga la caja', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(OPEN_SESSIONS);

      // `inventory` no toca `pos.cash_register.enabled`: el guard ni se activa.
      await service.updateSettings({ inventory: { low_stock_threshold: 5 } });

      expect(sessionsService.countOpenSessions).not.toHaveBeenCalled();
      expect(prisma.store_settings.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------- resetToDefault

  describe('resetToDefault', () => {
    it('bloquea el reset con sesiones abiertas y NO persiste', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(OPEN_SESSIONS);

      await expect(service.resetToDefault()).rejects.toMatchObject({
        errorCode: 'CASH_REGISTER_DISABLE_001',
      });
      expect(prisma.store_settings.upsert).not.toHaveBeenCalled();
    });

    it('permite el reset cuando no hay sesiones abiertas', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(NO_OPEN_SESSIONS);
      jest.spyOn(service, 'getSettings').mockResolvedValue({} as any);

      await service.resetToDefault();

      expect(prisma.store_settings.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------- applyTemplate

  describe('applyTemplate', () => {
    beforeEach(() => {
      prisma.default_templates.findFirst.mockResolvedValue({
        template_name: 'retail',
        template_data: { pos: { cash_register: { enabled: false } } },
      });
    });

    it('bloquea una plantilla que apaga la caja con sesiones abiertas', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(OPEN_SESSIONS);

      await expect(service.applyTemplate('retail')).rejects.toMatchObject({
        errorCode: 'CASH_REGISTER_DISABLE_001',
      });
      expect(prisma.store_settings.upsert).not.toHaveBeenCalled();
    });

    it('permite la plantilla cuando no hay sesiones abiertas', async () => {
      sessionsService.countOpenSessions.mockResolvedValue(NO_OPEN_SESSIONS);

      await service.applyTemplate('retail');

      expect(prisma.store_settings.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
