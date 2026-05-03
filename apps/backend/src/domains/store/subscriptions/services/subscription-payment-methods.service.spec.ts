// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models in this
// branch's generated client snapshot).
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionPaymentMethodsService } from './subscription-payment-methods.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformGatewayService } from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import { WompiClientFactory } from '../../payments/processors/wompi/wompi.factory';
import { RequestContextService } from '../../../../common/context/request-context.service';

const wompiCredsMock = {
  public_key: 'pub_test',
  private_key: 'priv_test',
  events_secret: 'events_test',
  integrity_secret: 'integ_test',
  environment: 'sandbox',
};

describe('SubscriptionPaymentMethodsService', () => {
  let service: SubscriptionPaymentMethodsService;
  let pmFindMany: jest.Mock;
  let pmFindFirst: jest.Mock;
  let pmCount: jest.Mock;
  let subFindUnique: jest.Mock;
  let pmCreate: jest.Mock;
  let pmUpdateMany: jest.Mock;
  let pmUpdate: jest.Mock;
  let eventsCreate: jest.Mock;
  let executeRaw: jest.Mock;
  let createPaymentSourceFromCardToken: jest.Mock;
  let getActiveCredentials: jest.Mock;

  beforeEach(async () => {
    pmFindMany = jest.fn();
    pmFindFirst = jest.fn();
    pmCount = jest.fn().mockResolvedValue(0);
    subFindUnique = jest.fn();
    pmCreate = jest.fn();
    pmUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    pmUpdate = jest.fn();
    eventsCreate = jest.fn().mockResolvedValue(undefined);
    executeRaw = jest.fn().mockResolvedValue(undefined);
    createPaymentSourceFromCardToken = jest.fn();
    getActiveCredentials = jest.fn().mockResolvedValue(wompiCredsMock);

    const txMock = {
      subscription_payment_methods: {
        findFirst: pmFindFirst,
        count: pmCount,
        updateMany: pmUpdateMany,
        create: pmCreate,
        update: pmUpdate,
      },
      subscription_events: { create: eventsCreate },
      $executeRaw: executeRaw,
    };

    const prismaMock = {
      subscription_payment_methods: {
        findMany: pmFindMany,
        findFirst: pmFindFirst,
      },
      store_subscriptions: { findUnique: subFindUnique },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionPaymentMethodsService,
        { provide: GlobalPrismaService, useValue: prismaMock },
        { provide: PlatformGatewayService, useValue: { getActiveCredentials } },
        {
          provide: WompiProcessor,
          useValue: { createPaymentSourceFromCardToken },
        },
        {
          provide: WompiClientFactory,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              getAcceptanceTokens: jest.fn().mockResolvedValue({
                acceptance_token: 'acc_test',
                personal_auth_token: 'pat_test',
              }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SubscriptionPaymentMethodsService);

    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── listForStore ───────────────────────────────────────────────────

  describe('listForStore', () => {
    it('returns consecutive_failures from the real column, not metadata', async () => {
      pmFindMany.mockResolvedValue([
        {
          id: 10,
          type: 'card',
          last4: '4242',
          brand: 'visa',
          is_default: true,
          created_at: new Date('2026-01-01T00:00:00Z'),
          expiry_month: '12',
          expiry_year: '2030',
          state: 'invalid',
          consecutive_failures: 2,
          metadata: { consecutive_failures: 99 },
          provider_payment_source_id: 'ps_123',
        },
      ]);

      const result = await service.listForStore();

      expect(pmFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ store_id: 42 }),
        }),
      );
      expect(result[0].consecutive_failures).toBe(2);
    });
  });

  // ── prepareWidgetConfig ────────────────────────────────────────────

  describe('prepareWidgetConfig', () => {
    it('returns acceptance_token + personal_auth_token from Wompi', async () => {
      const cfg = await service.prepareWidgetConfig({
        redirectUrl: 'https://x.test/redirect',
      });

      expect(cfg).toMatchObject({
        public_key: 'pub_test',
        currency: 'COP',
        amount_in_cents: 100,
        redirect_url: 'https://x.test/redirect',
        acceptance_token: 'acc_test',
        personal_auth_token: 'pat_test',
      });
    });
  });

  // ── tokenize / tokenizeAndRegister ─────────────────────────────────

  describe('tokenize (happy path)', () => {
    it('exchanges card_token for payment_source_id and persists PM', async () => {
      subFindUnique.mockResolvedValue({ id: 1 });
      // First findFirst inside the transaction = idempotency check; no row.
      pmFindFirst.mockResolvedValue(null);
      pmCount.mockResolvedValue(0);
      createPaymentSourceFromCardToken.mockResolvedValue({
        paymentSourceId: '12345',
        acceptanceTokenUsed: 'acc_used_xyz',
        publicData: {
          last_four: '4242',
          brand: 'visa',
          exp_month: '12',
          exp_year: '2030',
        },
      });
      pmCreate.mockResolvedValue({
        id: 88,
        type: 'card',
        last4: '4242',
        brand: 'visa',
        is_default: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        provider_payment_source_id: '12345',
      });

      const result = await service.tokenize({
        card_token: 'tok_widget_abc',
        acceptance_token: 'acc_widget',
        personal_auth_token: 'pat_widget',
        last4: '4242',
        brand: 'visa',
        expiry_month: '12',
        expiry_year: '2030',
      });

      // 1) Processor invoked with the widget tokens.
      expect(createPaymentSourceFromCardToken).toHaveBeenCalledTimes(1);
      const procArgs = createPaymentSourceFromCardToken.mock.calls[0][0];
      expect(procArgs).toMatchObject({
        storeId: 42,
        cardTokenFromWidget: 'tok_widget_abc',
        acceptanceToken: 'acc_widget',
        personalAuthToken: 'pat_widget',
      });
      expect(procArgs.idempotencyKey).toMatch(/^pm:tokenize:42:[0-9a-f]{16}$/);

      // 2) Advisory lock taken.
      expect(executeRaw).toHaveBeenCalled();

      // 3) PM created with payment_source_id + acceptance_token_used.
      expect(pmCreate).toHaveBeenCalledTimes(1);
      expect(pmCreate.mock.calls[0][0].data).toMatchObject({
        store_id: 42,
        store_subscription_id: 1,
        provider: 'wompi',
        provider_payment_source_id: '12345',
        provider_token: '12345',
        acceptance_token_used: 'acc_used_xyz',
        last4: '4242',
        brand: 'visa',
        is_default: true,
        state: 'active',
      });
      expect(pmCreate.mock.calls[0][0].data.cof_registered_at).toBeInstanceOf(
        Date,
      );

      // 4) Mapper exposes providerPaymentSourceId.
      expect(result).toMatchObject({
        id: '88',
        is_default: true,
        providerPaymentSourceId: '12345',
      });
    });
  });

  describe('tokenize (idempotency)', () => {
    it('returns existing PM and does NOT create a duplicate on retry', async () => {
      subFindUnique.mockResolvedValue({ id: 1 });
      // Both calls: processor returns same payment_source_id (Wompi
      // idempotency at the gateway side).
      createPaymentSourceFromCardToken.mockResolvedValue({
        paymentSourceId: '12345',
        acceptanceTokenUsed: 'acc_used_xyz',
        publicData: {},
      });
      // Second invocation finds the existing row.
      let callCount = 0;
      pmFindFirst.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) return null; // first call: idempotency check, no row
        // second call (second invocation of tokenize): row exists
        return {
          id: 88,
          type: 'card',
          last4: '4242',
          brand: 'visa',
          is_default: true,
          created_at: new Date('2026-01-01T00:00:00Z'),
          provider_payment_source_id: '12345',
        };
      });
      pmCount.mockResolvedValue(0);
      pmCreate.mockResolvedValue({
        id: 88,
        type: 'card',
        last4: '4242',
        brand: 'visa',
        is_default: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        provider_payment_source_id: '12345',
      });

      const dto = {
        card_token: 'tok_widget_abc',
        acceptance_token: 'acc_widget',
        personal_auth_token: 'pat_widget',
        last4: '4242',
        brand: 'visa',
      };
      const r1 = await service.tokenize(dto);
      const r2 = await service.tokenize(dto);

      // Both return id=88 referencing same payment_source.
      expect(r1.id).toBe('88');
      expect(r2.id).toBe('88');
      expect(r2.providerPaymentSourceId).toBe('12345');
      // Only the first call created a row; the second hit the dedup branch.
      expect(pmCreate).toHaveBeenCalledTimes(1);
    });
  });
});
