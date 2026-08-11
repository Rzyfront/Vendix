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

  // ------------------------------------------------- QUI-289: tri-estado del logo

  /**
   * QUI-289 — el borrado del logo respondía `success: true` sin borrar nada.
   * `extractS3KeyFromUrl(x) ?? undefined` convertía el `null` explícito en
   * `undefined`, y las tres compuertas de escritura filtran por `!== undefined`.
   *
   * Estos tres casos fijan el contrato tri-estado. Reintroducir el
   * `?? undefined` debe romper el caso "borra".
   */
  describe('updateSettings — tri-estado de logo_url (QUI-289)', () => {
    const EXISTING_LOGO = 'organizations/roku-6/stores/roku-10/logos/old.webp';
    const NEW_LOGO = 'organizations/roku-6/stores/roku-10/logos/new.webp';

    /** Fila `store_settings` simulada; el mock la lee y la escribe. */
    let stored: any;

    /** Estado persistido tras la última escritura. */
    const persisted = () => stored;

    beforeEach(() => {
      sessionsService.countOpenSessions.mockResolvedValue(NO_OPEN_SESSIONS);

      stored = {
        ...STORED_WITH_CASH_REGISTER_ON,
        branding: { logo_url: EXISTING_LOGO, favicon_url: EXISTING_LOGO },
      };

      // Mock CON ESTADO: `updateSettings` escribe el branding vía
      // `updateStoreBranding` y RE-LEE la fila antes del upsert final, justo
      // para no pisar lo que acaba de escribir. Con un `findUnique` fijo esa
      // relectura devolvería el estado viejo y el test mediría el mock en lugar
      // del servicio.
      prisma.store_settings.findUnique.mockImplementation(async () => ({
        store_id: STORE_ID,
        settings: stored,
      }));
      prisma.store_settings.upsert.mockImplementation(async ({ update }: any) => {
        stored = update?.settings ?? stored;
        return { store_id: STORE_ID, settings: stored };
      });

      // `generateFaviconForStore` es fire-and-forget y sale temprano si la
      // tienda no trae organización; así el test no depende de S3.
      prisma.stores.findUnique.mockResolvedValue(null);
    });

    it('borra el logo cuando llega null explícito', async () => {
      await service.updateSettings({ app: { logo_url: null } });

      expect(prisma.stores.update).toHaveBeenCalledWith({
        where: { id: STORE_ID },
        data: { logo_url: null },
      });
      expect(persisted().branding.logo_url).toBeNull();
    });

    it('borra el favicon cuando llega null explícito', async () => {
      await service.updateSettings({ app: { favicon_url: null } });

      expect(persisted().branding.favicon_url).toBeNull();
    });

    it('fija la clave saneada cuando llega un string', async () => {
      await service.updateSettings({ app: { logo_url: NEW_LOGO } });

      expect(prisma.stores.update).toHaveBeenCalledWith({
        where: { id: STORE_ID },
        data: { logo_url: NEW_LOGO },
      });
      expect(persisted().branding.logo_url).toBe(NEW_LOGO);
    });

    it('no toca el logo vigente cuando la clave no viene en el payload', async () => {
      await service.updateSettings({ app: { primary_color: '#123456' } });

      expect(prisma.stores.update).not.toHaveBeenCalled();
      expect(persisted().branding.logo_url).toBe(EXISTING_LOGO);
    });

    it('propaga el borrado a la tabla stores cuando llega por general', async () => {
      await service.updateSettings({ general: { logo_url: null } });

      expect(prisma.stores.update).toHaveBeenCalledWith({
        where: { id: STORE_ID },
        data: { logo_url: null },
      });
    });

    it('el null de app gana sobre la URL vieja que traiga general', async () => {
      // El panel manda ambas secciones: al borrar sólo anula `app`, mientras
      // `general` conserva la URL firmada anterior. El bloque de `general` corre
      // después y revivía el logo dentro de la misma peticion.
      await service.updateSettings({
        app: { logo_url: null },
        general: { logo_url: `https://s3.amazonaws.com/${EXISTING_LOGO}?X-Amz-Signature=abc` },
      });

      const updates = (prisma.stores.update as jest.Mock).mock.calls.map(
        (c) => c[0].data.logo_url,
      );
      expect(updates.every((v) => v === null)).toBe(true);
      expect(persisted().branding.logo_url).toBeNull();
    });
  });

  // ------------------------------------------- merge por clave de la sección vexi

  /**
   * El bucle de merge de `updateSettings` REEMPLAZA la sección enviada. Para
   * `vexi` eso es destructivo, porque sus dos campos se editan desde controles
   * distintos de la misma pantalla: el interruptor maestro manda
   * `{ enabled }` y el selector de motor manda `{ voice_engine }`. Con reemplazo
   * de sección, cada uno borraba al otro y la tienda volvía al default sin aviso.
   *
   * Quitar el bloque de merge de `vexi` debe romper exactamente los dos primeros
   * casos de aquí.
   */
  describe('updateSettings — merge por clave de vexi', () => {
    let stored: any;

    beforeEach(() => {
      sessionsService.countOpenSessions.mockResolvedValue(NO_OPEN_SESSIONS);

      // Cualquier PATCH sobre `vexi` pasa por una compuerta de rol propia
      // (owner/admin), independiente del permiso `store:settings:update`. Sin
      // este mock los cuatro casos fallan con SYS_FORBIDDEN_001 y no se llega a
      // medir el merge.
      jest
        .spyOn(RequestContextService, 'getRoles')
        .mockReturnValue(['owner'] as any);

      stored = {
        ...STORED_WITH_CASH_REGISTER_ON,
        vexi: { enabled: true, voice_engine: 'realtime' },
      };

      prisma.store_settings.findUnique.mockImplementation(async () => ({
        store_id: STORE_ID,
        settings: stored,
      }));
      prisma.store_settings.upsert.mockImplementation(
        async ({ update }: any) => {
          stored = update?.settings ?? stored;
          return { store_id: STORE_ID, settings: stored };
        },
      );
    });

    it('mover el interruptor conserva el motor elegido', async () => {
      await service.updateSettings({ vexi: { enabled: false } });

      expect(stored.vexi.enabled).toBe(false);
      // Éste es el aserto que importa: sin el merge por clave, `voice_engine`
      // desaparecía del objeto persistido y la tienda caía al default.
      expect(stored.vexi.voice_engine).toBe('realtime');
    });

    it('cambiar el motor conserva el interruptor', async () => {
      await service.updateSettings({ vexi: { voice_engine: 'pipeline' } });

      expect(stored.vexi.voice_engine).toBe('pipeline');
      expect(stored.vexi.enabled).toBe(true);
    });

    it('un PATCH que no menciona vexi no toca la sección', async () => {
      await service.updateSettings({ inventory: { low_stock_threshold: 5 } });

      expect(stored.vexi).toEqual({
        enabled: true,
        voice_engine: 'realtime',
      });
    });

    it('acepta la sección completa sin duplicar ni perder claves', async () => {
      await service.updateSettings({
        vexi: { enabled: false, voice_engine: 'pipeline' },
      });

      expect(stored.vexi).toEqual({
        enabled: false,
        voice_engine: 'pipeline',
      });
    });

    it('un manager no puede cambiar el motor, no sólo el interruptor', async () => {
      // El motor no es una preferencia cosmética: sólo el pipeline pasa por la
      // tarjeta de confirmación, así que elegirlo amplía lo que la asistente
      // puede escribir. `store:settings:update` lo tiene también un manager, de
      // modo que la compuerta de rol es lo único que separa a un manager de
      // ampliar la capacidad de Vexi con un curl.
      jest
        .spyOn(RequestContextService, 'getRoles')
        .mockReturnValue(['manager'] as any);

      await expect(
        service.updateSettings({ vexi: { voice_engine: 'pipeline' } }),
      ).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });

      expect(stored.vexi.voice_engine).toBe('realtime');
    });
  });
});
