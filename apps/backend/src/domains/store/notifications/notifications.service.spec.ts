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
