import { NotificationsService } from './notifications.service';
import { RequestContextService } from '@common/context/request-context.service';
import { notification_type_enum } from '@prisma/client';

describe('NotificationsService — initDefaultSubscriptions', () => {
  function buildService() {
    const subscriptionsCreateMany = jest.fn().mockResolvedValue(undefined);
    const subscriptionsFindMany = jest.fn().mockResolvedValue([]);

    const prismaMock = {
      notifications: {},
      notification_subscriptions: {
        findMany: subscriptionsFindMany,
        createMany: subscriptionsCreateMany,
      },
    } as any;
    const globalPrismaMock = {} as any;
    const sseMock = { push: jest.fn() } as any;
    const pushMock = { sendToStore: jest.fn() } as any;

    const service = new NotificationsService(
      prismaMock,
      globalPrismaMock,
      sseMock,
      pushMock,
    );

    return { service, subscriptionsFindMany, subscriptionsCreateMany };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 42 } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts the two billing-warning types with in_app=true / email=false', async () => {
    const { service, subscriptionsFindMany, subscriptionsCreateMany } =
      buildService();
    subscriptionsFindMany.mockResolvedValueOnce([]);

    await service.initDefaultSubscriptions(7);

    expect(subscriptionsCreateMany).toHaveBeenCalledTimes(1);
    const rows = subscriptionsCreateMany.mock.calls[0][0].data;
    const noCredRow = rows.find(
      (r: any) => r.type === 'auto_renew_disabled_no_credential',
    );
    const chargeFailedRow = rows.find(
      (r: any) => r.type === 'auto_renew_charge_failed',
    );

    expect(noCredRow).toBeDefined();
    expect(noCredRow).toMatchObject({
      store_id: 42,
      user_id: 7,
      type: 'auto_renew_disabled_no_credential',
      in_app: true,
      email: false,
    });

    expect(chargeFailedRow).toBeDefined();
    expect(chargeFailedRow).toMatchObject({
      store_id: 42,
      user_id: 7,
      type: 'auto_renew_charge_failed',
      in_app: true,
      email: false,
    });

    // Sanity: types match the schema enum additions.
    expect(noCredRow.type).toBe(notification_type_enum.auto_renew_disabled_no_credential);
    expect(chargeFailedRow.type).toBe(notification_type_enum.auto_renew_charge_failed);
  });

  it('skips the billing-warning rows when the user already subscribed', async () => {
    const { service, subscriptionsFindMany, subscriptionsCreateMany } =
      buildService();
    // Pretend the user already has both rows persisted.
    subscriptionsFindMany.mockResolvedValueOnce([
      { type: 'auto_renew_disabled_no_credential' },
      { type: 'auto_renew_charge_failed' },
    ]);

    await service.initDefaultSubscriptions(7);

    // createMany still gets called (for any other missing types) but the
    // dedupe Set inside initDefaultSubscriptions must exclude both rows.
    if (subscriptionsCreateMany.mock.calls.length > 0) {
      const rows = subscriptionsCreateMany.mock.calls[0][0].data;
      const types = rows.map((r: any) => r.type);
      expect(types).not.toContain('auto_renew_disabled_no_credential');
      expect(types).not.toContain('auto_renew_charge_failed');
    }
  });
});

describe('NotificationsService — QUI-854 multi-tenant fail-closed', () => {
  function buildService(context: any) {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(0);

    const prismaMock = {
      notifications: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      notification_subscriptions: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
      $queryRawUnsafe: queryRawUnsafe,
      $executeRawUnsafe: executeRawUnsafe,
    } as any;
    const globalPrismaMock = {} as any;
    const sseMock = { push: jest.fn() } as any;
    const pushMock = { sendToStore: jest.fn() } as any;

    const service = new NotificationsService(
      prismaMock,
      globalPrismaMock,
      sseMock,
      pushMock,
    );

    return { service, prismaMock, queryRawUnsafe, executeRawUnsafe };
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(null as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('findAll returns empty on missing store_id (fail-closed)', async () => {
    const { service, queryRawUnsafe } = buildService(null);
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(undefined);

    const result = await service.findAll(7, {} as any);

    expect(result.data).toEqual([]);
    expect(result.unread_count).toBe(0);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('findAll with store_id forces n.store_id filter always', async () => {
    const { service, queryRawUnsafe } = buildService(null);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 42, app_type: 'STORE_ADMIN' } as any);

    await service.findAll(7, {} as any);

    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('n.store_id = $1');
    expect(queryRawUnsafe.mock.calls[0][1]).toBe(42);
  });

  it('customer (STORE_ECOMMERCE) cannot see store broadcasts — only self-targeted', async () => {
    const { service, queryRawUnsafe } = buildService(null);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({
        store_id: 42,
        user_id: 7,
        app_type: 'STORE_ECOMMERCE',
      } as any);

    await service.findAll(7, {} as any);

    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    // No broadcast branch (n.data IS NULL targets) for customers.
    expect(sql).not.toContain(`'target_user_id' IS NULL`);
    expect(sql).toContain(`(n.data->>'target_user_id')::int`);
    // And no "OR" broadcast alternative.
    expect(sql).not.toMatch(/OR \(n\.data->>'target_user_id'\)::int/);
  });

  it('markAllRead without store_id touches nothing (fail-closed)', async () => {
    const { service, executeRawUnsafe } = buildService(null);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);

    const result = await service.markAllRead();

    expect(result.count).toBe(0);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('markAllRead scopes by store and (customer) by target user', async () => {
    const { service, executeRawUnsafe } = buildService(null);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({
        store_id: 42,
        user_id: 7,
        app_type: 'STORE_ECOMMERCE',
      } as any);

    await service.markAllRead();

    const sql = executeRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('n.store_id = $1');
    expect(sql).toContain(`(n.data->>'target_user_id')::int = $2`);
    expect(executeRawUnsafe.mock.calls[0][1]).toBe(42);
    expect(executeRawUnsafe.mock.calls[0][2]).toBe(7);
  });
});
