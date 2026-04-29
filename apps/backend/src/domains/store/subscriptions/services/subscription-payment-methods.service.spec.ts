// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models in this
// branch's generated client snapshot).
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionPaymentMethodsService } from './subscription-payment-methods.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformGatewayService } from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

describe('SubscriptionPaymentMethodsService.replace (G11)', () => {
  let service: SubscriptionPaymentMethodsService;
  let pmFindFirst: jest.Mock;
  let subFindUnique: jest.Mock;
  let pmCreate: jest.Mock;
  let pmUpdateMany: jest.Mock;
  let pmUpdate: jest.Mock;
  let eventsCreate: jest.Mock;

  beforeEach(async () => {
    pmFindFirst = jest.fn();
    subFindUnique = jest.fn();
    pmCreate = jest.fn();
    pmUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    pmUpdate = jest.fn();
    eventsCreate = jest.fn().mockResolvedValue(undefined);

    const txMock = {
      subscription_payment_methods: {
        updateMany: pmUpdateMany,
        create: pmCreate,
        update: pmUpdate,
      },
      subscription_events: { create: eventsCreate },
    };

    const prismaMock = {
      subscription_payment_methods: { findFirst: pmFindFirst },
      store_subscriptions: { findUnique: subFindUnique },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionPaymentMethodsService,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: PlatformGatewayService,
          useValue: { getActiveCredentials: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(SubscriptionPaymentMethodsService);

    // RequestContextService.getStoreId() is read at the top of replace().
    // Stubbed to a fixed store so we don't need AsyncLocalStorage.
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('soft-deletes the old PM, creates a new one, transfers is_default', async () => {
    pmFindFirst.mockResolvedValue({
      id: 7,
      store_id: 42,
      store_subscription_id: 1,
      type: 'card',
      is_default: true,
      metadata: null,
    });
    subFindUnique.mockResolvedValue({ id: 1 });
    pmCreate.mockResolvedValue({
      id: 8,
      type: 'card',
      last4: '1111',
      brand: 'visa',
      is_default: true,
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    pmUpdate.mockResolvedValue({ id: 7 });

    const result = await service.replace('7', {
      provider_token: 'tok_new_'.padEnd(20, 'x'),
      type: 'card',
      last4: '1111',
      brand: 'visa',
      expiry_month: '12',
      expiry_year: '2030',
    });

    // 1) Old defaults cleared (because new PM inherits default).
    expect(pmUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: 42, is_default: true },
        data: expect.objectContaining({ is_default: false }),
      }),
    );

    // 2) New PM created with is_default=true, state='active', metadata
    //    pointing back to the replaced row.
    expect(pmCreate).toHaveBeenCalledTimes(1);
    expect(pmCreate.mock.calls[0][0].data).toMatchObject({
      store_id: 42,
      store_subscription_id: 1,
      type: 'card',
      provider: 'wompi',
      provider_token: expect.stringContaining('tok_new_'),
      is_default: true,
      state: 'active',
      metadata: { replaces_id: 7 },
    });

    // 3) Old PM marked replaced + metadata.replaced_by_id = new PM id.
    expect(pmUpdate).toHaveBeenCalledTimes(1);
    expect(pmUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 7 } });
    expect(pmUpdate.mock.calls[0][0].data).toMatchObject({
      state: 'replaced',
      is_default: false,
    });
    expect(pmUpdate.mock.calls[0][0].data.metadata).toMatchObject({
      replaced_by_id: 8,
    });
    expect(pmUpdate.mock.calls[0][0].data.metadata.replaced_at).toEqual(
      expect.any(String),
    );

    // 4) Audit row.
    expect(eventsCreate).toHaveBeenCalledTimes(1);
    expect(eventsCreate.mock.calls[0][0].data).toMatchObject({
      store_subscription_id: 1,
      type: 'state_transition',
      payload: expect.objectContaining({
        reason: 'payment_method_replaced',
        old_payment_method_id: 7,
        new_payment_method_id: 8,
        inherits_default: true,
      }),
    });

    expect(result).toMatchObject({
      id: '8',
      is_default: true,
    });
  });

  it('does NOT clear other defaults when the old PM was not default', async () => {
    pmFindFirst.mockResolvedValue({
      id: 7,
      store_id: 42,
      store_subscription_id: 1,
      type: 'card',
      is_default: false,
      metadata: null,
    });
    subFindUnique.mockResolvedValue({ id: 1 });
    pmCreate.mockResolvedValue({
      id: 8,
      type: 'card',
      last4: null,
      brand: null,
      is_default: false,
      created_at: new Date(),
    });
    pmUpdate.mockResolvedValue({ id: 7 });

    await service.replace('7', {
      provider_token: 'tok_new_'.padEnd(20, 'x'),
    });

    expect(pmUpdateMany).not.toHaveBeenCalled();
    expect(pmCreate.mock.calls[0][0].data.is_default).toBe(false);
  });
});
