import { Prisma } from '@prisma/client';
import { SubscriptionCheckoutController } from './subscription-checkout.controller';

describe('SubscriptionCheckoutController', () => {
  let controller: SubscriptionCheckoutController;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_plans: {
        findUnique: jest.fn(),
      },
    };

    controller = new SubscriptionCheckoutController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prismaMock,
      {} as any,
    );
  });

  async function deriveChangeKind(
    currentCycle: string,
    currentPrice: string,
    targetCycle: string,
    targetPrice: string,
  ): Promise<string> {
    prismaMock.subscription_plans.findUnique.mockImplementation(
      async ({ where }: any) => {
        if (where.id === 1) {
          return {
            base_price: new Prisma.Decimal(currentPrice),
            billing_cycle: currentCycle,
          };
        }
        return {
          base_price: new Prisma.Decimal(targetPrice),
          billing_cycle: targetCycle,
        };
      },
    );

    return (controller as any).deriveChangeKind(
      {
        state: 'active',
        plan_id: 1,
        paid_plan_id: 1,
      },
      2,
    );
  }

  it.each<[string, string]>([
    ['monthly', '200000'],
    ['quarterly', '600000'],
    ['semiannual', '1200000'],
    ['annual', '2400000'],
    ['yearly', '2400000'],
    ['lifetime', '240000000'],
  ])(
    'classifies %s to a lower monthly-equivalent target as downgrade',
    async (sourceCycle, sourcePrice) => {
      await expect(
        deriveChangeKind(sourceCycle, sourcePrice, 'monthly', '119000'),
      ).resolves.toBe('downgrade');
    },
  );

  it('classifies raw-more-expensive quarterly target by monthly equivalent', async () => {
    await expect(
      deriveChangeKind('monthly', '150000', 'quarterly', '300000'),
    ).resolves.toBe('downgrade');
  });

  it('classifies cross-cycle target with higher monthly equivalent as upgrade', async () => {
    await expect(
      deriveChangeKind('monthly', '100000', 'semiannual', '900000'),
    ).resolves.toBe('upgrade');
  });
});
