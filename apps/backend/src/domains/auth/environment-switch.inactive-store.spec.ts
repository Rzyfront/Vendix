import { EnvironmentSwitchService } from './environment-switch.service';
import { ErrorCodes } from '../../common/errors';

/**
 * Regla de producto (incidente vendix-centro, 2026-11-18):
 *  - (el cambio de tienda siempre exige slug: la auto-selección es la del
 *    login y está cubierta en auth.service.spec.ts);
 *  - owner/admin SÍ pueden abrirla a propósito desde el panel de la org
 *    (slug explícito), pero no queda guardada como main_store_id;
 *  - el resto de roles recibe AUTH_STORE_INACTIVE_001.
 */
describe('EnvironmentSwitchService — tiendas inactivas', () => {
  const ORG = 1;

  function setup(
    roleName: string,
    store: { id: number; is_active: boolean },
    userState?: string,
  ) {
    const prisma: any = {
      users: {
        findUnique: jest
          .fn()
          // 1ª lectura: el usuario con sus roles.
          .mockResolvedValueOnce({
            id: 7,
            organization_id: ORG,
            main_store_id: 1,
            ...(userState ? { state: userState } : {}),
            user_roles: [{ roles: { name: roleName } }],
          })
          // 2ª lectura (usuario completo, después de persistir main_store):
          // null corta el flujo justo después del punto que se verifica.
          .mockResolvedValueOnce(null),
        update: jest.fn(),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({ organization_id: ORG }),
        findFirst: jest.fn().mockResolvedValue({
          ...store,
          slug: 'vendix-centro',
          organization_id: ORG,
          store_settings: null,
          store_users: [{ id: 1 }],
        }),
      },
      store_users: { findFirst: jest.fn(), create: jest.fn() },
      user_settings: { upsert: jest.fn() },
      user_roles: { findMany: jest.fn().mockResolvedValue([]) },
      organizations: { findUnique: jest.fn() },
    };
    const service = new EnvironmentSwitchService(
      prisma,
      { sign: jest.fn(() => 'token') } as any,
      { get: jest.fn() } as any,
      { log: jest.fn() } as any,
      { generatePanelUI: jest.fn() } as any,
      { signUrl: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'createUserSession')
      .mockResolvedValue(undefined);
    return { service, prisma };
  }

  it.each(['owner', 'admin'])(
    '%s abre a propósito una tienda inactiva y no queda como main_store_id',
    async (role) => {
      const { service, prisma } = setup(role, { id: 2, is_active: false });

      await expect(
        service.switchEnvironment(7, 'STORE_ADMIN', 'vendix-centro'),
      ).rejects.toThrow('Usuario no encontrado');

      // Llegó a emitir la sesión (el token se firmó) …
      expect(prisma.user_settings.upsert).toHaveBeenCalled();
      // … pero la tienda inactiva no se guardó como tienda de arranque.
      expect(prisma.users.update).not.toHaveBeenCalled();
    },
  );

  it('un rol de tienda (manager) no puede abrir una tienda inactiva', async () => {
    const { service, prisma } = setup('manager', { id: 2, is_active: false });

    await expect(
      service.switchEnvironment(7, 'STORE_ADMIN', 'vendix-centro'),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.AUTH_STORE_INACTIVE_001.code,
    });
    expect(prisma.user_settings.upsert).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('una tienda activa sí queda como main_store_id', async () => {
    const { service, prisma } = setup('owner', { id: 1, is_active: true });

    await expect(
      service.switchEnvironment(7, 'STORE_ADMIN', 'vendix-crm'),
    ).rejects.toThrow('Usuario no encontrado');

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { main_store_id: 1 },
    });
  });

  /**
   * QUI-1045 — una cuenta desactivada, suspendida o archivada no abre otro
   * entorno con un access token que todavía no venció.
   */
  it.each(['inactive', 'suspended', 'archived'])(
    'una cuenta %s no cambia de entorno (QUI-1045)',
    async (state) => {
      const { service, prisma } = setup(
        'owner',
        { id: 1, is_active: true },
        state,
      );

      await expect(
        service.switchEnvironment(7, 'STORE_ADMIN', 'vendix-crm'),
      ).rejects.toThrow('Usuario no encontrado');
      expect(prisma.stores.findFirst).not.toHaveBeenCalled();
      expect(prisma.user_settings.upsert).not.toHaveBeenCalled();
    },
  );

  it('una cuenta pending_verification sí cambia de entorno (QUI-1045)', async () => {
    const { service, prisma } = setup(
      'owner',
      { id: 1, is_active: true },
      'pending_verification',
    );

    await expect(
      service.switchEnvironment(7, 'STORE_ADMIN', 'vendix-crm'),
    ).rejects.toThrow('Usuario no encontrado');
    expect(prisma.user_settings.upsert).toHaveBeenCalled();
  });
});
