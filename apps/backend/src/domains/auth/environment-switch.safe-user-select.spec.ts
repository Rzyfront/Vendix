import { EnvironmentSwitchService } from './environment-switch.service';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
} from '../../testing/user-row-fixture';

/**
 * Switching between the organization panel and a store
 * (`POST /auth/switch-environment`) returns a new session: its user carries
 * profile columns only, and the session keeps everything the panel needs.
 */
describe('EnvironmentSwitchService — session user with minimal columns', () => {
  it('returns the session without credentials nor lockout counters', async () => {
    const prisma: any = {
      users: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 5,
            organization_id: 3,
            main_store_id: 4,
            user_roles: [{ roles: { name: 'owner' } }],
          })
          .mockResolvedValueOnce({
            ...fullUserRow(5),
            organizations: { id: 3, name: 'Org' },
            addresses: [],
          }),
        update: jest.fn(),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({ organization_id: 3 }),
        findFirst: jest.fn().mockResolvedValue({
          id: 4,
          is_active: true,
          slug: 'tienda-centro',
          organization_id: 3,
          logo_url: null,
          store_settings: null,
          store_users: [{ id: 1 }],
        }),
      },
      store_users: { findFirst: jest.fn(), create: jest.fn() },
      user_settings: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user_roles: {
        findMany: jest.fn().mockResolvedValue([
          {
            roles: {
              name: 'owner',
              role_permissions: [{ permissions: { name: 'store:read' } }],
            },
          },
        ]),
      },
      organizations: { findUnique: jest.fn() },
    };
    const service = new EnvironmentSwitchService(
      prisma,
      { sign: jest.fn(() => 'signed-token') } as any,
      { get: jest.fn() } as any,
      { log: jest.fn() } as any,
      { generatePanelUI: jest.fn().mockResolvedValue({ panel_ui: {} }) } as any,
      { signUrl: jest.fn(async (key: string | null) => key) } as any,
    );
    jest
      .spyOn(service as any, 'createUserSession')
      .mockResolvedValue(undefined);

    const session: any = await service.switchEnvironment(
      5,
      'STORE_ADMIN',
      'tienda-centro',
    );

    expectNoSensitiveUserFields(session.user);
    expect(session.user).toEqual(
      expect.objectContaining({
        id: 5,
        email: 'user5@tienda.co',
        roles: ['owner'],
        store: expect.objectContaining({ id: 4, slug: 'tienda-centro' }),
      }),
    );
    expect(session).toEqual(
      expect.objectContaining({
        access_token: 'signed-token',
        refresh_token: 'signed-token',
        permissions: ['store:read'],
        updatedEnvironment: 'STORE_ADMIN',
      }),
    );
  });
});
