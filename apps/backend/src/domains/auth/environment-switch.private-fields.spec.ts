import { EnvironmentSwitchService } from './environment-switch.service';

/**
 * QUI-966 T8 (S16): the environment-switch response carries the same user
 * object as login; it must not serialize `two_factor_secret` nor `password`.
 */
describe('EnvironmentSwitchService — private user fields (QUI-966 S16)', () => {
  it('ORG_ADMIN switch: user has no two_factor_secret/password, rest unchanged', async () => {
    const userRow = {
      id: 1,
      email: 'owner@test.com',
      password: 'hashed',
      two_factor_secret: 'JBSWY3DPEHPK3PXP',
      failed_login_attempts: 0,
      locked_until: null,
      organization_id: 1,
      main_store_id: null,
      user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
    };
    const prisma: any = {
      users: { findUnique: jest.fn().mockResolvedValue(userRow), update: jest.fn() },
      organizations: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, account_type: 'MULTI_STORE' }),
      },
      refresh_tokens: { create: jest.fn().mockResolvedValue({}) },
      user_settings: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          user_id: 1,
          app_type: 'ORG_ADMIN',
          config: {},
        }),
      },
      user_roles: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ roles: { name: 'owner', role_permissions: [] } }]),
      },
      stores: { findUnique: jest.fn(), findFirst: jest.fn() },
      store_users: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    };
    const service = new EnvironmentSwitchService(
      prisma,
      { sign: jest.fn(() => 'token') } as any,
      { get: jest.fn() } as any,
      { log: jest.fn() } as any,
      { generatePanelUI: jest.fn().mockResolvedValue({ panel_ui: {} }) } as any,
      { signUrl: jest.fn((u) => u) } as any,
    );

    const result: any = await service.switchEnvironment(1, 'ORG_ADMIN');

    expect(result.user).not.toHaveProperty('two_factor_secret');
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).toEqual(
      expect.objectContaining({
        id: 1,
        email: 'owner@test.com',
        failed_login_attempts: 0,
        locked_until: null,
        organization_id: 1,
        roles: ['owner'],
        store: null,
      }),
    );
    expect(result.updatedEnvironment).toBe('ORG_ADMIN');
  });
});
