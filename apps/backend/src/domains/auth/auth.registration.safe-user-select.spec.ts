import { AuthService } from './auth.service';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
} from '../../testing/user-row-fixture';

/**
 * Registration and the Super Admin email verification answer with the user
 * they just created or changed: profile columns, roles and session only.
 * The full row (password hash included) is still what they read.
 */
describe('AuthService — registration answers with minimal user columns', () => {
  const NEW_USER_ID = 20;
  const storedUser = (roleName: string, permissions: string[] = []) => ({
    ...fullUserRow(NEW_USER_ID),
    user_roles: [
      {
        roles: {
          name: roleName,
          role_permissions: permissions.map((name) => ({
            permissions: { name },
          })),
        },
      },
    ],
    user_settings: { id: 1, app_type: 'STORE_ECOMMERCE', config: {} },
    organizations: { id: 3, slug: 'org-a', domain_settings: [] },
  });

  let prisma: any;
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: NEW_USER_ID,
          email: `user${NEW_USER_ID}@tienda.co`,
        }),
        update: jest.fn(),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          name: 'Tienda Centro',
          organization_id: 3,
          organizations: { name: 'Org', slug: 'org-a' },
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 4, organization_id: 3 }),
      },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
        findUnique: jest.fn().mockResolvedValue({ name: 'Org', slug: 'org-a' }),
      },
      roles: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
      user_settings: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          user_id: NEW_USER_ID,
          app_type: 'STORE_ECOMMERCE',
          config: {},
        }),
      },
      user_roles: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          { roles: { name: 'customer', role_permissions: [] } },
        ]),
      },
      store_users: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      login_attempts: { create: jest.fn().mockResolvedValue({}) },
      workflow_definitions: { findFirst: jest.fn().mockResolvedValue(null) },
      email_verification_tokens: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new AuthService(
      prisma,
      { sign: jest.fn(() => 'token') } as never,
      { sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }) } as never,
      {
        getStoreBranding: jest.fn().mockResolvedValue({}),
        getOrganizationBranding: jest.fn().mockResolvedValue({}),
        getStoreEcommerceUrl: jest.fn().mockResolvedValue('https://tienda.test'),
      } as never,
      { get: jest.fn() } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn(), logAuth: jest.fn() } as never,
      {} as never,
      { generatePanelUI: jest.fn().mockResolvedValue({ panel_ui: {} }) } as never,
      { signUrl: jest.fn(async (key: string | null) => key) } as never,
      { emit: jest.fn() } as never,
      {} as never,
    );
    jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
      access_token: 'access.jwt',
      refresh_token: 'refresh.jwt',
      token_type: 'Bearer',
      expires_in: 900,
    });
    jest.spyOn(service as any, 'createUserSession').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('POST /auth/register-customer', async () => {
    prisma.users.findFirst.mockImplementation(async (args: any) =>
      args?.where?.id ? storedUser('customer') : null,
    );

    const result: any = await service.registerCustomer({
      email: 'User20@Tienda.co',
      password: 'Clave-Segura-2026!',
      first_name: 'ana',
      last_name: 'pérez',
      store_id: 4,
    } as never);

    expectNoSensitiveUserFields(result.user);
    expect(result.user).toEqual(
      expect.objectContaining({ id: NEW_USER_ID, roles: ['customer'] }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'access.jwt',
        refresh_token: 'refresh.jwt',
      }),
    );
  });

  it('POST /auth/register-staff', async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: 9,
      email: 'admin@tienda.co',
      organization_id: 3,
      user_roles: [{ roles: { name: 'owner' } }],
    });
    prisma.users.findFirst.mockImplementation(async (args: any) =>
      args?.where?.id ? storedUser('manager', ['orders:read']) : null,
    );

    const result: any = await service.registerStaff(
      {
        email: 'user20@tienda.co',
        password: 'Clave-Segura-2026!',
        first_name: 'ana',
        last_name: 'pérez',
        role: 'manager',
        store_id: 4,
      } as never,
      9,
    );

    expectNoSensitiveUserFields(result.user);
    expect(result.user).toEqual(expect.objectContaining({ id: NEW_USER_ID }));
    expect(result.permissions).toEqual(['orders:read']);
  });

  it('POST /auth/super-admin/verify-email/:userId', async () => {
    prisma.users.findUnique
      .mockResolvedValueOnce({
        id: 1,
        email: 'root@vendix.com',
        user_roles: [{ roles: { name: 'super_admin' } }],
      })
      .mockResolvedValueOnce({ ...fullUserRow(NEW_USER_ID), email_verified: false });
    prisma.users.update.mockResolvedValue({
      ...fullUserRow(NEW_USER_ID),
      email_verified: true,
    });

    const result = await service.verifyUserEmailAsSuperAdmin(NEW_USER_ID, 1);

    expectNoSensitiveUserFields(result.user);
    expect(result.user).toEqual(
      expect.objectContaining({ id: NEW_USER_ID, email_verified: true }),
    );
  });
});
