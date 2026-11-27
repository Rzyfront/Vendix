import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ApplyOrderCouponDto } from './dto/apply-order-coupon.dto';
import {
  ApplyOrderCouponDeps,
  ApplyOrderCouponPlannedLine,
  executeApplyOrderCoupon,
} from './utils/apply-order-coupon.util';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  applyGrossDiscountRetax,
  distributeAmount,
  resolveGrossDiscountByLine,
} from '../taxes/utils/order-discount-tax.util';
import { roundMoney } from '../products/services/price-unit.util';

describe('executeApplyOrderCoupon & ApplyOrderCouponDto', () => {
  const STORE_ID = 10;
  const ORDER_ID = 500;

  let deps: ApplyOrderCouponDeps;
  let prisma: any;
  let couponsService: any;
  let promotionEngine: any;
  let auditService: any;
  let orderSse: any;
  let contextSpy: jest.SpyInstance;

  const baseOrder = (overrides: Record<string, any> = {}) => ({
    id: ORDER_ID,
    store_id: STORE_ID,
    order_number: 'ORD-0500',
    state: 'created',
    customer_id: 42,
    payment_form: '1',
    subtotal_amount: 1000,
    tax_amount: 190,
    discount_amount: 0,
    shipping_cost: 0,
    tip_amount: 0,
    grand_total: 1190,
    total_paid: 0,
    remaining_balance: null,
    coupon_id: null,
    coupon_code: null,
    active_financial_split_id: null,
    order_items: [
      {
        id: 101,
        product_id: 7,
        product_variant_id: null,
        quantity: 1,
        unit_price: 1000,
        total_price: 1000,
        final_unit_price: 1190,
        tax_rate: 0.19,
        tax_amount_item: 190,
        discount_amount: 0,
        cancelled_at: null,
        order_item_taxes: [
          {
            id: 201,
            tax_rate_id: 1,
            tax_name: 'IVA',
            tax_rate: 0.19,
            tax_amount: 190,
            tax_type: 'VAT',
            is_compound: false,
            is_inclusive: false,
          },
        ],
      },
    ],
    order_promotions: [],
    coupon_uses: [],
    payments: [],
    order_installments: [],
    ...overrides,
  });

  const plannedLinePreDiscountTax = (line: ApplyOrderCouponPlannedLine) => {
    const base = Number(line.total_price || 0);
    if (line.taxes.length > 0) {
      return roundMoney(
        line.taxes.reduce((s, t) => s + base * Number(t.tax_rate || 0), 0),
      );
    }
    return roundMoney(base * Number(line.tax_rate || 0));
  };

  const grossOfPlannedLines = (lines: ApplyOrderCouponPlannedLine[]) =>
    roundMoney(
      lines.reduce(
        (s, l) => s + Number(l.total_price || 0) + plannedLinePreDiscountTax(l),
        0,
      ),
    );

  const sumPlannedOrderLines = (lines: ApplyOrderCouponPlannedLine[]) => ({
    subtotal: roundMoney(
      lines.reduce((s, l) => s + Number(l.total_price || 0), 0),
    ),
    tax: roundMoney(
      lines.reduce((s, l) => s + Number(l.line_tax_total || 0), 0),
    ),
  });

  const applyGrossDiscountToPlannedLines: ApplyOrderCouponDeps['applyGrossDiscountToPlannedLines'] =
    (lines, grossDiscount, split = null) => {
      const discountable = lines.map((line) => {
        const base = Number(line.total_price || 0);
        const preTax = plannedLinePreDiscountTax(line);
        const taxRows =
          line.taxes.length > 0
            ? line.taxes.map((t) => ({
                rate: Number(t.tax_rate || 0),
                tax_type: t.tax_type,
                tax_rate_id: t.tax_rate_id,
                tax_name: t.tax_name,
              }))
            : [
                {
                  rate: base > 0 ? preTax / base : 0,
                  tax_type: null,
                  tax_rate_id: null,
                  tax_name: '',
                },
              ];
        return {
          base,
          grossOriginal: roundMoney(base + preTax),
          taxRows: taxRows as any,
        };
      });
      const grossByLine =
        grossDiscount <= 0
          ? discountable.map(() => 0)
          : split
            ? resolveGrossDiscountByLine(
                discountable.map((l) => l.grossOriginal),
                split,
              )
            : distributeAmount(
                grossDiscount,
                discountable.map((l) => l.grossOriginal),
              );
      const retax = applyGrossDiscountRetax(discountable, grossByLine);
      return {
        lines: lines.map((line, i) => {
          const r = retax.lines[i];
          const mult =
            Number(line.unit_price) > 0
              ? Number(line.total_price) / Number(line.unit_price)
              : 0;
          return {
            ...line,
            line_tax_total: r.taxTotal,
            tax_amount_item:
              line.tax_amount_item == null || mult <= 0
                ? line.tax_amount_item
                : roundMoney(r.taxTotal / mult),
            taxes: line.taxes.map((t, k) => ({
              ...t,
              tax_amount: r.taxes[k]?.amount ?? t.tax_amount,
            })),
          };
        }),
        discountByLine: retax.lines.map((l) => l.baseDiscount),
        tax: retax.totalTax,
        baseDiscount: retax.totalBaseDiscount,
      };
    };

  beforeEach(() => {
    prisma = {
      orders: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
      },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
      },
      order_item_taxes: {
        update: jest.fn().mockResolvedValue({}),
      },
      order_promotions: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product_categories: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ product_id: 7, category_id: 3 }]),
      },
      coupons: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      coupon_uses: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 901 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payments: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      refunds: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(prisma)),
    };

    couponsService = {
      validate: jest.fn(),
    };
    promotionEngine = {
      resolveDiscountCode: jest.fn().mockResolvedValue({ kind: 'none' }),
      quoteDiscounts: jest.fn(),
      quoteWithPromotionCode: jest.fn(),
    };
    auditService = {
      logCustom: jest.fn().mockResolvedValue(undefined),
    };
    orderSse = {
      pushOrderEvent: jest.fn(),
    };

    deps = {
      prisma,
      couponsService,
      promotionEngine,
      auditService,
      orderSse,
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any,
      plannedLinePreDiscountTax,
      grossOfPlannedLines,
      sumPlannedOrderLines,
      applyGrossDiscountToPlannedLines,
      computeOrderGrandTotal: ({ subtotal, tax, discount, shipping, tip }) =>
        Math.max(0, roundMoney(subtotal + tax - discount + shipping + tip)),
      assertTotalNotBelowPaid: async (_tx, _id, _storeId, nextGrandTotal) => {
        const settled = await prisma.payments.findMany();
        const paid = settled.reduce(
          (s: Prisma.Decimal, p: { amount: number }) =>
            s.plus(new Prisma.Decimal(p.amount ?? 0)),
          new Prisma.Decimal(0),
        );
        if (paid.gt(0) && new Prisma.Decimal(nextGrandTotal).lt(paid)) {
          throw new VendixHttpException(ErrorCodes.ORD_EDIT_BELOW_PAID_001);
        }
      },
      findOne: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    };

    contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      user_id: 99,
      request_id: 'req-1',
    } as any);
  });

  afterEach(() => {
    contextSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('ApplyOrderCouponDto', () => {
    it('trims and uppercases non-empty coupon_code and normalizes blank strings to null', () => {
      const filled = plainToInstance(ApplyOrderCouponDto, {
        coupon_code: '  promo10  ',
      });
      expect(filled.coupon_code).toBe('PROMO10');
      expect(validateSync(filled)).toHaveLength(0);

      const blank = plainToInstance(ApplyOrderCouponDto, {
        coupon_code: '   ',
      });
      expect(blank.coupon_code).toBeNull();
      expect(validateSync(blank)).toHaveLength(0);

      const cleared = plainToInstance(ApplyOrderCouponDto, {
        coupon_code: null,
      });
      expect(cleared.coupon_code).toBeNull();
      expect(validateSync(cleared)).toHaveLength(0);
    });

    it('rejects coupon_code exceeding 50 characters', () => {
      const tooLong = plainToInstance(ApplyOrderCouponDto, {
        coupon_code: 'A'.repeat(51),
      });
      expect(validateSync(tooLong)).toHaveLength(1);
    });
  });

  describe('draft orders (quota deferred to payment)', () => {
    it('applies 10% coupon on draft, recalculates base discount/VAT/total, without burning quota', async () => {
      prisma.orders.findFirst.mockResolvedValue(baseOrder({ state: 'draft' }));
      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 119,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' });

      expect(prisma.coupon_uses.create).not.toHaveBeenCalled();
      expect(prisma.coupons.updateMany).not.toHaveBeenCalled();
      expect(prisma.order_items.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: { discount_amount: 100, tax_amount_item: 171 },
      });
      expect(prisma.order_item_taxes.update).toHaveBeenCalledWith({
        where: { id: 201 },
        data: { tax_amount: 171 },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({
            subtotal_amount: 1000,
            discount_amount: 100,
            tax_amount: 171,
            grand_total: 1071,
            coupon_id: 11,
            coupon_code: 'DESC10',
          }),
        }),
      );
    });

    it('removes coupon from draft and restores original VAT and grand_total without decrementing quota', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        baseOrder({
          state: 'draft',
          coupon_id: 11,
          coupon_code: 'DESC10',
          discount_amount: 100,
          tax_amount: 171,
          grand_total: 1071,
          order_items: [
            {
              ...baseOrder().order_items[0],
              discount_amount: 100,
              tax_amount_item: 171,
              order_item_taxes: [
                {
                  ...baseOrder().order_items[0].order_item_taxes[0],
                  tax_amount: 171,
                },
              ],
            },
          ],
        }),
      );

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: null });

      expect(prisma.coupons.updateMany).not.toHaveBeenCalled();
      expect(prisma.coupon_uses.deleteMany).not.toHaveBeenCalled();
      expect(prisma.order_items.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: { discount_amount: 0, tax_amount_item: 190 },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotal_amount: 1000,
            discount_amount: 0,
            tax_amount: 190,
            grand_total: 1190,
            coupon_id: null,
            coupon_code: null,
          }),
        }),
      );
    });
  });

  describe('non-draft unpaid orders (created / pending_payment)', () => {
    it('applies coupon on created order, writes coupon_uses once and increments current_uses with max_uses guard', async () => {
      prisma.orders.findFirst.mockResolvedValue(baseOrder({ state: 'created' }));
      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 119,
      });
      prisma.coupons.findFirst.mockResolvedValue({
        id: 11,
        current_uses: 0,
        max_uses: 1,
        is_active: true,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' });

      expect(prisma.coupons.updateMany).toHaveBeenCalledWith({
        where: {
          id: 11,
          store_id: STORE_ID,
          is_active: true,
          current_uses: { lt: 1 },
        },
        data: { current_uses: { increment: 1 } },
      });
      expect(prisma.coupon_uses.create).toHaveBeenCalledWith({
        data: {
          coupon_id: 11,
          order_id: ORDER_ID,
          customer_id: 42,
          discount_applied: 119,
        },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            grand_total: 1071,
            coupon_id: 11,
            coupon_code: 'DESC10',
          }),
        }),
      );
    });

    it('removes coupon from created order, deletes coupon_uses, decrements current_uses and restores totals', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        baseOrder({
          state: 'created',
          coupon_id: 11,
          coupon_code: 'DESC10',
          discount_amount: 100,
          tax_amount: 171,
          grand_total: 1071,
          order_items: [
            {
              ...baseOrder().order_items[0],
              discount_amount: 100,
              tax_amount_item: 171,
              order_item_taxes: [
                {
                  ...baseOrder().order_items[0].order_item_taxes[0],
                  tax_amount: 171,
                },
              ],
            },
          ],
        }),
      );

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: null });

      expect(prisma.coupon_uses.deleteMany).toHaveBeenCalledWith({
        where: { order_id: ORDER_ID, coupon_id: 11 },
      });
      expect(prisma.coupons.updateMany).toHaveBeenCalledWith({
        where: { id: 11, store_id: STORE_ID, current_uses: { gt: 0 } },
        data: { current_uses: { decrement: 1 } },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discount_amount: 0,
            tax_amount: 190,
            grand_total: 1190,
            coupon_id: null,
            coupon_code: null,
          }),
        }),
      );
    });

    it('replaces coupon A with coupon B on created order cleanly', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        baseOrder({
          state: 'created',
          coupon_id: 11,
          coupon_code: 'OLD10',
          discount_amount: 100,
          tax_amount: 171,
          grand_total: 1071,
        }),
      );
      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 22,
        code: 'NEW20',
        discount_amount: 238,
      });
      prisma.coupons.findFirst.mockResolvedValue({
        id: 22,
        current_uses: 0,
        max_uses: 5,
        is_active: true,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'NEW20' });

      expect(prisma.coupon_uses.deleteMany).toHaveBeenCalledWith({
        where: { order_id: ORDER_ID, coupon_id: 11 },
      });
      expect(prisma.coupons.updateMany).toHaveBeenCalledWith({
        where: { id: 11, store_id: STORE_ID, current_uses: { gt: 0 } },
        data: { current_uses: { decrement: 1 } },
      });
      expect(prisma.coupons.updateMany).toHaveBeenCalledWith({
        where: {
          id: 22,
          store_id: STORE_ID,
          is_active: true,
          current_uses: { lt: 5 },
        },
        data: { current_uses: { increment: 1 } },
      });
      expect(prisma.coupon_uses.create).toHaveBeenCalledWith({
        data: {
          coupon_id: 22,
          order_id: ORDER_ID,
          customer_id: 42,
          discount_applied: 238,
        },
      });
    });

    it('applies coupon on pending_payment order with partial payment and recalculates remaining_balance', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        baseOrder({
          state: 'pending_payment',
          total_paid: 500,
          remaining_balance: 690,
          payments: [{ id: 1, amount: 500, state: 'succeeded' }],
        }),
      );
      prisma.payments.findMany.mockResolvedValue([{ amount: 500 }]);
      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_amount: 119,
      });
      prisma.coupons.findFirst.mockResolvedValue({
        id: 11,
        current_uses: 0,
        max_uses: null,
        is_active: true,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' });

      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            grand_total: 1071,
            remaining_balance: 571,
          }),
        }),
      );
    });

    it('rejects coupon that drops grand_total below already-settled partial payment', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        baseOrder({
          state: 'pending_payment',
          total_paid: 1100,
          remaining_balance: 90,
          payments: [{ id: 1, amount: 1100, state: 'succeeded' }],
        }),
      );
      prisma.payments.findMany.mockResolvedValue([{ amount: 1100 }]);
      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_amount: 119,
      });

      await expect(
        executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_BELOW_PAID_001.code,
      });
      expect(prisma.orders.update).not.toHaveBeenCalled();
      expect(prisma.coupon_uses.create).not.toHaveBeenCalled();
    });
  });

  describe('error preservation & guards', () => {
    it('propagates CPN_EXPIRED_001 directly without mutating the order', async () => {
      prisma.orders.findFirst.mockResolvedValue(baseOrder({ state: 'created' }));
      couponsService.validate.mockRejectedValue(
        new VendixHttpException(ErrorCodes.CPN_EXPIRED_001),
      );

      await expect(
        executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'VENCIDO' }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.CPN_EXPIRED_001.code,
      });
      expect(prisma.orders.update).not.toHaveBeenCalled();
      expect(prisma.coupons.updateMany).not.toHaveBeenCalled();
    });

    it('rejects finished, cancelled, already-paid, or credit-with-installments orders', async () => {
      prisma.orders.findFirst.mockResolvedValueOnce(
        baseOrder({ state: 'finished' }),
      );
      await expect(
        executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
      });

      prisma.orders.findFirst.mockResolvedValueOnce(
        baseOrder({
          state: 'created',
          payment_form: '2',
          order_installments: [{ id: 1 }],
        }),
      );
      await expect(
        executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
      });

      prisma.orders.findFirst.mockResolvedValueOnce(
        baseOrder({
          state: 'pending_payment',
          payments: [{ id: 1, amount: 1190, state: 'succeeded' }],
        }),
      );
      await expect(
        executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
      });

      expect(prisma.orders.update).not.toHaveBeenCalled();
    });

    it('removes and replaces checkout coupon stored only in coupon_uses (orders.coupon_id = null)', async () => {
      prisma.orders.findFirst.mockResolvedValueOnce(
        baseOrder({
          state: 'created',
          coupon_id: null,
          coupon_code: null,
          discount_amount: 100,
          tax_amount: 171,
          grand_total: 1071,
          coupon_uses: [
            {
              id: 77,
              coupon_id: 11,
              discount_applied: 119,
              coupon: { code: 'ECOM10' },
            },
          ],
        }),
      );

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: null });

      expect(prisma.coupon_uses.deleteMany).toHaveBeenCalledWith({
        where: { order_id: ORDER_ID, coupon_id: 11 },
      });
      expect(prisma.coupons.updateMany).toHaveBeenCalledWith({
        where: { id: 11, store_id: STORE_ID, current_uses: { gt: 0 } },
        data: { current_uses: { decrement: 1 } },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            grand_total: 1190,
            coupon_id: null,
            coupon_code: null,
          }),
        }),
      );
    });

    it('preserves and restores tax on custom items without order_item_taxes rows', async () => {
      const customItemOrder = baseOrder({
        state: 'draft',
        order_items: [
          {
            id: 105,
            product_id: null,
            product_variant_id: null,
            quantity: 1,
            unit_price: 1000,
            total_price: 1000,
            final_unit_price: 1190,
            tax_rate: 0.19,
            tax_amount_item: 190,
            discount_amount: 0,
            cancelled_at: null,
            order_item_taxes: [],
          },
        ],
      });
      prisma.orders.findFirst.mockResolvedValueOnce(customItemOrder);
      couponsService.validate.mockResolvedValueOnce({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_amount: 119,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'desc10' });

      expect(prisma.order_items.update).toHaveBeenCalledWith({
        where: { id: 105 },
        data: { discount_amount: 100, tax_amount_item: 171 },
      });
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tax_amount: 171,
            grand_total: 1071,
          }),
        }),
      );
    });

    it('does not overwrite remaining_balance on pending_payment online-gateway orders with remaining_balance = 0', async () => {
      prisma.orders.findFirst.mockResolvedValueOnce(
        baseOrder({
          state: 'pending_payment',
          remaining_balance: 0,
          total_paid: 0,
          payments: [{ id: 1, amount: 1190, state: 'pending' }],
        }),
      );
      couponsService.validate.mockResolvedValueOnce({
        valid: true,
        coupon_id: 11,
        code: 'DESC10',
        discount_amount: 119,
      });
      prisma.coupons.findFirst.mockResolvedValueOnce({
        id: 11,
        current_uses: 0,
        max_uses: null,
        is_active: true,
      });

      await executeApplyOrderCoupon(deps, ORDER_ID, { coupon_code: 'DESC10' });

      const updateData = prisma.orders.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('remaining_balance');
      expect(updateData.grand_total).toBe(1071);
    });
  });
});
