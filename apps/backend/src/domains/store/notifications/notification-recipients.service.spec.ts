import { NotificationRecipientsService } from './notification-recipients.service';

const STORE_ID = 10;
const ORG_ID = 1;

type Assignment = { store_id: number | null; roles: { name: string } | null };

function user(
  id: number,
  overrides: Partial<{
    state: string;
    email: string | null;
    organization_id: number;
    user_roles: Assignment[];
  }> = {},
) {
  return {
    user: {
      id,
      state: 'active',
      email: `u${id}@tienda.co`,
      first_name: `U${id}`,
      organization_id: ORG_ID,
      user_roles: [{ store_id: null, roles: { name: 'employee' } }],
      ...overrides,
    },
  };
}

function build(links: ReturnType<typeof user>[], store: unknown = { organization_id: ORG_ID }) {
  const storeUsersFindMany = jest.fn().mockResolvedValue(links);
  const prisma = {
    stores: { findUnique: jest.fn().mockResolvedValue(store) },
    store_users: { findMany: storeUsersFindMany },
  } as any;
  return { service: new NotificationRecipientsService(prisma), storeUsersFindMany };
}

describe('NotificationRecipientsService.classify', () => {
  it('solo busca vínculos de ESA tienda (aislamiento por tienda)', async () => {
    const { service, storeUsersFindMany } = build([user(1)]);
    await service.classify(STORE_ID, [1, 2]);
    expect(storeUsersFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: STORE_ID, user_id: { in: [1, 2] } },
      }),
    );
  });

  it('personal activo de la tienda es staff, con su correo', async () => {
    const { service } = build([user(1)]);
    const result = await service.classify(STORE_ID, [1]);
    expect(result.get(1)).toEqual({
      user_id: 1,
      kind: 'staff',
      email: 'u1@tienda.co',
      first_name: 'U1',
    });
  });

  it('usuario de otra tienda (sin vínculo) no recibe nada', async () => {
    const { service } = build([]);
    const result = await service.classify(STORE_ID, [99], { allow_store_customers: true });
    expect(result.size).toBe(0);
  });

  it('personal dado de baja no recibe nada, ni por el puente legado', async () => {
    const { service } = build([user(1, { state: 'inactive' }), user(2, { state: 'suspended' })]);
    const result = await service.classify(STORE_ID, [1, 2], { allow_store_customers: true });
    expect(result.size).toBe(0);
  });

  it('cliente final: nada por defecto; cliente solo con allow_store_customers', async () => {
    const customer = user(3, { user_roles: [{ store_id: null, roles: { name: 'customer' } }] });
    const strict = await build([customer]).service.classify(STORE_ID, [3]);
    expect(strict.size).toBe(0);

    const legacy = await build([customer]).service.classify(STORE_ID, [3], {
      allow_store_customers: true,
    });
    expect(legacy.get(3)?.kind).toBe('customer');
  });

  it('rol de otra tienda u organización no lo hace personal de esta', async () => {
    const otherStoreRole = user(4, { user_roles: [{ store_id: 77, roles: { name: 'manager' } }] });
    const otherOrgRole = user(5, {
      organization_id: 2,
      user_roles: [{ store_id: null, roles: { name: 'owner' } }],
    });
    const result = await build([otherStoreRole, otherOrgRole]).service.classify(STORE_ID, [4, 5]);
    expect(result.size).toBe(0);
  });

  it('rol asignado a esta tienda sí lo hace personal', async () => {
    const storeRole = user(6, { user_roles: [{ store_id: STORE_ID, roles: { name: 'cajero' } }] });
    const result = await build([storeRole]).service.classify(STORE_ID, [6]);
    expect(result.get(6)?.kind).toBe('staff');
  });

  it('sin correo o con correo vacío queda email null', async () => {
    const { service } = build([user(7, { email: '  ' }), user(8, { email: null })]);
    const result = await service.classify(STORE_ID, [7, 8]);
    expect(result.get(7)?.email).toBeNull();
    expect(result.get(8)?.email).toBeNull();
  });

  it('tienda inexistente o lista vacía: nadie', async () => {
    expect((await build([user(1)], null).service.classify(STORE_ID, [1])).size).toBe(0);
    const { service, storeUsersFindMany } = build([user(1)]);
    expect((await service.classify(STORE_ID, [])).size).toBe(0);
    expect(storeUsersFindMany).not.toHaveBeenCalled();
  });
});
