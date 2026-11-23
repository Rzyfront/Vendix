import { SettingsService } from './settings.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  getPersistableDefaultStoreSettings,
  mergeStoreSettingsWithDefaults,
} from './defaults/default-store-settings';

/**
 * T16 / N5 — la tienda ya no configura el motor de voz.
 *
 * `vexi.voice_engine` sigue aceptándose (una pestaña vieja lo envía) pero se
 * ignora: nunca se persiste ni sobrescribe el valor legado.
 */
const STORE_ID = 10;
const USER_ID = 15;

describe('SettingsService — vexi.voice_engine obsoleto (T16)', () => {
  let service: SettingsService;
  let stored: any;
  let prisma: any;
  let auditService: { logUpdate: jest.Mock };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);
    jest
      .spyOn(RequestContextService, 'getRoles')
      .mockReturnValue(['owner'] as any);

    stored = {
      inventory: { low_stock_threshold: 3 },
      vexi: { enabled: true, voice_engine: 'realtime' },
      vex: { enabled: true },
    };

    prisma = {
      store_settings: {
        findUnique: jest.fn(async () => ({
          store_id: STORE_ID,
          settings: stored,
        })),
        upsert: jest.fn(async ({ update }: any) => {
          stored = update?.settings ?? stored;
          return { store_id: STORE_ID, settings: stored };
        }),
      },
      default_templates: { findFirst: jest.fn() },
      stores: { findUnique: jest.fn(), update: jest.fn() },
    };
    auditService = { logUpdate: jest.fn().mockResolvedValue(undefined) };

    service = new SettingsService(
      prisma as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      auditService as any,
      {} as any,
      {} as any,
      { countOpenSessions: jest.fn() } as any,
      { invalidateStore: jest.fn() } as any,
    );
  });

  it('un PATCH solo con voice_engine no lanza y no cambia lo persistido', async () => {
    await expect(
      service.updateSettings({ vexi: { voice_engine: 'realtime' } } as any),
    ).resolves.toBeDefined();

    expect(stored.vexi).toEqual({ enabled: true, voice_engine: 'realtime' });
    // Sin cambio real no hay fila de auditoría espuria.
    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });

  it('el valor ignorado nunca sobrescribe el legado', async () => {
    await service.updateSettings({ vexi: { voice_engine: 'pipeline' } } as any);

    expect(stored.vexi.voice_engine).toBe('realtime');
  });

  it('aplica enabled e ignora voice_engine en el mismo PATCH', async () => {
    await service.updateSettings({
      vexi: { voice_engine: 'pipeline', enabled: false },
    } as any);

    expect(stored.vexi).toEqual({ enabled: false, voice_engine: 'realtime' });
    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const changed = auditService.logUpdate.mock.calls[0][4];
    expect(changed.vexi.new.enabled).toBe(false);
  });

  it('una tienda sin valor legado tampoco lo recibe', async () => {
    stored = { vexi: { enabled: false } };

    await service.updateSettings({
      vexi: { voice_engine: 'pipeline', enabled: true },
    } as any);

    expect(stored.vexi).toEqual({ enabled: true });
    expect('voice_engine' in stored.vexi).toBe(false);
  });

  it('el default ya no trae voice_engine', () => {
    expect((getPersistableDefaultStoreSettings() as any).vexi).not.toHaveProperty(
      'voice_engine',
    );
    expect(
      (mergeStoreSettingsWithDefaults({}) as any).vexi,
    ).not.toHaveProperty('voice_engine');
  });

  it('regresión: un PATCH de otra sección se comporta igual', async () => {
    await service.updateSettings({ vex: { enabled: false } });
    expect(stored.vex).toEqual({ enabled: false });
    expect(stored.vexi).toEqual({ enabled: true, voice_engine: 'realtime' });

    await service.updateSettings({ inventory: { low_stock_threshold: 5 } });
    expect(stored.inventory.low_stock_threshold).toBe(5);
    expect(auditService.logUpdate).toHaveBeenCalledTimes(2);
  });
});
