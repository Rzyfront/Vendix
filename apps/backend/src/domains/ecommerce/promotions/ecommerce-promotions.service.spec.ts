import { EcommercePromotionsService } from './ecommerce-promotions.service';
import { buildPromotionClock } from '../../store/promotions/promotion-schedule.util';

/** Vitrina pública: muestra exactamente lo que el carrito aplicaría hoy. */
describe('EcommercePromotionsService.getActivePromotions', () => {
  // Jueves 19-nov-2026 10:00 en Bogotá.
  const NOW = new Date('2026-11-19T15:00:00Z');
  let prisma: any;
  let service: EcommercePromotionsService;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    name: 'Promo',
    state: 'active',
    scope: 'order',
    rule_type: 'flat',
    type: 'percentage',
    value: 10,
    min_purchase_amount: null,
    usage_limit: null,
    usage_count: 0,
    active_weekdays: [],
    promotion_quantity_tiers: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = { promotions: { findMany: jest.fn() } };
    const engine: any = {
      getStoreClock: jest.fn().mockResolvedValue(buildPromotionClock(NOW, 'America/Bogota')),
      buildPromotionBadgeLabel: jest.fn().mockReturnValue('-10% OFF'),
    };
    service = new EcommercePromotionsService(prisma, engine);
  });

  it('incluye programadas ya iniciadas y excluye otro día / cupo agotado', async () => {
    prisma.promotions.findMany.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, state: 'scheduled' }),
      row({ id: 3, active_weekdays: [2] }),
      row({ id: 4, usage_limit: 2, usage_count: 2 }),
      row({ id: 5, active_weekdays: [4] }),
    ]);
    const result = await service.getActivePromotions();
    expect(result.map((p) => p.id)).toEqual([1, 2, 5]);
    expect(result[2].active_weekdays).toEqual([4]);
    const args = prisma.promotions.findMany.mock.calls[0][0];
    expect(args.where.state).toEqual({ in: ['active', 'scheduled'] });
    expect(args.orderBy).toEqual([{ priority: 'asc' }, { id: 'asc' }]);
  });
});
