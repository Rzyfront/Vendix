import { CouponsService } from './coupons.service';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

const build = (coupon: Record<string, any>, uses: { total: number; own: number; ownCustomer?: number }) => {
  const prisma: any = {
    coupons: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1, code: 'C1', name: 'C', is_active: true, valid_from: past, valid_until: future,
        discount_type: 'FIXED_AMOUNT', discount_value: 10, applies_to: 'ALL_PRODUCTS',
        min_purchase_amount: null, max_discount_amount: null, max_uses: null,
        max_uses_per_customer: null, current_uses: 0, coupon_products: [], coupon_categories: [],
        ...coupon,
      }),
    },
    coupon_uses: {
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where.order_id != null) return where.customer_id != null ? (uses.ownCustomer ?? uses.own) : uses.own;
        return uses.total;
      }),
    },
  };
  return new CouponsService(prisma);
};
const dto: any = { code: 'C1', cart_subtotal: 100, customer_id: 7, items: [] };

describe('CouponsService.validate — excludeOrderId (QUI-650)', () => {
  it('por defecto cuenta todos los usos (comportamiento intacto)', async () => {
    const svc = build({ max_uses: 1, current_uses: 1 }, { total: 0, own: 1 });
    await expect(svc.validate(dto)).rejects.toMatchObject({ errorCode: 'CPN_LIMIT_001' });
    const per = build({ max_uses_per_customer: 1 }, { total: 1, own: 1 });
    await expect(per.validate(dto)).rejects.toMatchObject({ errorCode: 'CPN_LIMIT_002' });
  });

  it('con excludeOrderId descuenta los usos de esa orden en el límite global y por cliente', async () => {
    const svc = build({ max_uses: 1, current_uses: 1 }, { total: 0, own: 1 });
    await expect(svc.validate(dto, { excludeOrderId: 55 })).resolves.toMatchObject({ valid: true });
    const per = build({ max_uses_per_customer: 1 }, { total: 1, own: 1 });
    await expect(per.validate(dto, { excludeOrderId: 55 })).resolves.toMatchObject({ valid: true });
    // un uso AJENO sí sigue contando
    const other = build({ max_uses: 1, current_uses: 2 }, { total: 0, own: 1 });
    await expect(other.validate(dto, { excludeOrderId: 55 })).rejects.toMatchObject({ errorCode: 'CPN_LIMIT_001' });
  });
});
