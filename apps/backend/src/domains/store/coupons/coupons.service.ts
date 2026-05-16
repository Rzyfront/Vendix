import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateCouponDto,
  UpdateCouponDto,
  CouponQueryDto,
  ValidateCouponDto,
  CouponDiscountType,
  CouponAppliesTo,
} from './dto';

@Injectable()
export class CouponsService {
  constructor(private prisma: StorePrismaService) {}

  async create(dto: CreateCouponDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Validate: percentage <= 100
    if (
      dto.discount_type === CouponDiscountType.PERCENTAGE &&
      dto.discount_value > 100
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
    }

    // Validate: valid_from < valid_until
    if (new Date(dto.valid_from) >= new Date(dto.valid_until)) {
      throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
    }

    this.validateTargetSelection(
      dto.applies_to ?? CouponAppliesTo.ALL_PRODUCTS,
      dto.product_ids,
      dto.category_ids,
    );

    // Check unique code in store
    const existing = await this.prisma.coupons.findFirst({
      where: { code: dto.code },
    });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.CPN_DUP_001);
    }

    return this.prisma.$transaction(async (tx: any) => {
      const coupon = await tx.coupons.create({
        data: {
          store_id,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          discount_type: dto.discount_type,
          discount_value: dto.discount_value,
          min_purchase_amount: dto.min_purchase_amount,
          max_discount_amount: dto.max_discount_amount,
          max_uses: dto.max_uses,
          max_uses_per_customer: dto.max_uses_per_customer ?? 1,
          valid_from: new Date(dto.valid_from),
          valid_until: new Date(dto.valid_until),
          is_active: dto.is_active ?? true,
          applies_to: dto.applies_to ?? CouponAppliesTo.ALL_PRODUCTS,
        },
      });

      // Create junction table entries
      if (
        dto.applies_to === CouponAppliesTo.SPECIFIC_PRODUCTS &&
        dto.product_ids?.length
      ) {
        await tx.coupon_products.createMany({
          data: dto.product_ids.map((product_id) => ({
            coupon_id: coupon.id,
            product_id,
          })),
        });
      }

      if (
        dto.applies_to === CouponAppliesTo.SPECIFIC_CATEGORIES &&
        dto.category_ids?.length
      ) {
        await tx.coupon_categories.createMany({
          data: dto.category_ids.map((category_id) => ({
            coupon_id: coupon.id,
            category_id,
          })),
        });
      }

      return tx.coupons.findUnique({
        where: { id: coupon.id },
        include: {
          coupon_products: { include: { product: true } },
          coupon_categories: { include: { category: true } },
        },
      });
    });
  }

  async findAll(query: CouponQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      is_active,
      discount_type,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (is_active !== undefined) where.is_active = is_active;
    if (discount_type) where.discount_type = discount_type;

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.coupons.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          coupon_products: {
            include: { product: { select: { id: true, name: true } } },
          },
          coupon_categories: {
            include: { category: { select: { id: true, name: true } } },
          },
          _count: { select: { coupon_uses: true } },
        },
      }),
      this.prisma.coupons.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const coupon = await this.prisma.coupons.findFirst({
      where: { id },
      include: {
        coupon_products: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
        coupon_categories: {
          include: { category: { select: { id: true, name: true } } },
        },
        _count: { select: { coupon_uses: true } },
      },
    });

    if (!coupon) {
      throw new VendixHttpException(ErrorCodes.CPN_FIND_001);
    }

    return coupon;
  }

  async update(id: number, dto: UpdateCouponDto) {
    const existing = await this.findOne(id);

    // Validate: percentage <= 100
    if (
      dto.discount_type === CouponDiscountType.PERCENTAGE &&
      dto.discount_value &&
      dto.discount_value > 100
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
    }

    // Validate dates if both provided
    if (dto.valid_from && dto.valid_until) {
      if (new Date(dto.valid_from) >= new Date(dto.valid_until)) {
        throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
      }
    }

    this.validateTargetSelection(
      dto.applies_to ?? existing.applies_to,
      dto.product_ids ??
        existing.coupon_products?.map((cp: any) => cp.product_id) ??
        [],
      dto.category_ids ??
        existing.coupon_categories?.map((cc: any) => cc.category_id) ??
        [],
    );

    return this.prisma.$transaction(async (tx: any) => {
      const updateData: any = {};
      if (dto.code !== undefined) updateData.code = dto.code;
      if (dto.name !== undefined) updateData.name = dto.name;
      if (dto.description !== undefined)
        updateData.description = dto.description;
      if (dto.discount_type !== undefined)
        updateData.discount_type = dto.discount_type;
      if (dto.discount_value !== undefined)
        updateData.discount_value = dto.discount_value;
      if (dto.min_purchase_amount !== undefined)
        updateData.min_purchase_amount = dto.min_purchase_amount;
      if (dto.max_discount_amount !== undefined)
        updateData.max_discount_amount = dto.max_discount_amount;
      if (dto.max_uses !== undefined) updateData.max_uses = dto.max_uses;
      if (dto.max_uses_per_customer !== undefined)
        updateData.max_uses_per_customer = dto.max_uses_per_customer;
      if (dto.valid_from !== undefined)
        updateData.valid_from = new Date(dto.valid_from);
      if (dto.valid_until !== undefined)
        updateData.valid_until = new Date(dto.valid_until);
      if (dto.is_active !== undefined) updateData.is_active = dto.is_active;
      if (dto.applies_to !== undefined) updateData.applies_to = dto.applies_to;

      await tx.coupons.update({
        where: { id },
        data: updateData,
      });

      // Replace junction tables if applies_to changed
      if (dto.applies_to !== undefined || dto.product_ids !== undefined) {
        await tx.coupon_products.deleteMany({ where: { coupon_id: id } });
        if (dto.product_ids?.length) {
          await tx.coupon_products.createMany({
            data: dto.product_ids.map((product_id) => ({
              coupon_id: id,
              product_id,
            })),
          });
        }
      }

      if (dto.applies_to !== undefined || dto.category_ids !== undefined) {
        await tx.coupon_categories.deleteMany({ where: { coupon_id: id } });
        if (dto.category_ids?.length) {
          await tx.coupon_categories.createMany({
            data: dto.category_ids.map((category_id) => ({
              coupon_id: id,
              category_id,
            })),
          });
        }
      }

      return tx.coupons.findUnique({
        where: { id },
        include: {
          coupon_products: {
            include: { product: { select: { id: true, name: true } } },
          },
          coupon_categories: {
            include: { category: { select: { id: true, name: true } } },
          },
        },
      });
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    // Soft delete
    return this.prisma.coupons.update({
      where: { id },
      data: { is_active: false },
    });
  }

  async validate(dto: ValidateCouponDto) {
    const coupon = await this.prisma.coupons.findFirst({
      where: { code: dto.code, is_active: true },
      include: {
        coupon_products: true,
        coupon_categories: true,
      },
    });

    if (!coupon) {
      throw new VendixHttpException(ErrorCodes.CPN_FIND_001);
    }

    const now = new Date();

    // Check dates
    if (
      now < new Date(coupon.valid_from) ||
      now > new Date(coupon.valid_until)
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_EXPIRED_001);
    }

    // Check global usage limit
    if (coupon.max_uses && coupon.current_uses >= coupon.max_uses) {
      throw new VendixHttpException(ErrorCodes.CPN_LIMIT_001);
    }

    // Check per-customer usage
    if (dto.customer_id && coupon.max_uses_per_customer) {
      const customerUses = await this.prisma.coupon_uses.count({
        where: {
          coupon_id: coupon.id,
          customer_id: dto.customer_id,
        },
      });
      if (customerUses >= coupon.max_uses_per_customer) {
        throw new VendixHttpException(ErrorCodes.CPN_LIMIT_002);
      }
    }

    // Check minimum purchase
    if (
      coupon.min_purchase_amount &&
      dto.cart_subtotal < Number(coupon.min_purchase_amount)
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_MIN_001);
    }

    const applicableSubtotal = this.getApplicableSubtotal(coupon, dto);
    if (applicableSubtotal <= 0) {
      throw new VendixHttpException(ErrorCodes.CPN_APPLY_001);
    }

    // Calculate discount
    let discount_amount = 0;
    if (coupon.discount_type === 'PERCENTAGE') {
      discount_amount =
        (applicableSubtotal * Number(coupon.discount_value)) / 100;
      // Apply cap
      const maxDiscountAmount = Number(coupon.max_discount_amount);
      if (Number.isFinite(maxDiscountAmount) && maxDiscountAmount > 0) {
        discount_amount = Math.min(discount_amount, maxDiscountAmount);
      }
    } else {
      discount_amount = Number(coupon.discount_value);
    }

    // Discount cannot exceed subtotal
    discount_amount = Math.min(discount_amount, applicableSubtotal);
    discount_amount = Math.round(discount_amount * 100) / 100;

    return {
      valid: true,
      coupon_id: coupon.id,
      code: coupon.code,
      name: coupon.name,
      discount_type: coupon.discount_type,
      discount_value: Number(coupon.discount_value),
      discount_amount,
      min_purchase_amount: coupon.min_purchase_amount
        ? Number(coupon.min_purchase_amount)
        : null,
      max_discount_amount: coupon.max_discount_amount
        ? Number(coupon.max_discount_amount)
        : null,
    };
  }

  private validateTargetSelection(
    appliesTo: CouponAppliesTo | string,
    productIds?: number[],
    categoryIds?: number[],
  ): void {
    if (
      appliesTo === CouponAppliesTo.SPECIFIC_PRODUCTS &&
      (!productIds || productIds.length === 0)
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
    }

    if (
      appliesTo === CouponAppliesTo.SPECIFIC_CATEGORIES &&
      (!categoryIds || categoryIds.length === 0)
    ) {
      throw new VendixHttpException(ErrorCodes.CPN_VALIDATE_001);
    }
  }

  private getApplicableSubtotal(coupon: any, dto: ValidateCouponDto): number {
    const cartItems = dto.items || [];

    if (coupon.applies_to === CouponAppliesTo.SPECIFIC_PRODUCTS) {
      const couponProductIds = coupon.coupon_products.map((cp) =>
        Number(cp.product_id),
      );
      const matchingItems = cartItems.filter((item) =>
        couponProductIds.includes(Number(item.product_id)),
      );

      if (cartItems.length > 0) {
        return this.sumLineTotals(matchingItems);
      }

      const hasApplicable = (dto.product_ids || []).some((pid) =>
        couponProductIds.includes(Number(pid)),
      );
      return hasApplicable ? dto.cart_subtotal : 0;
    }

    if (coupon.applies_to === CouponAppliesTo.SPECIFIC_CATEGORIES) {
      const couponCategoryIds = coupon.coupon_categories.map((cc) =>
        Number(cc.category_id),
      );
      const matchingItems = cartItems.filter((item) =>
        this.getCouponItemCategoryIds(item).some((categoryId) =>
          couponCategoryIds.includes(categoryId),
        ),
      );

      if (cartItems.length > 0) {
        return this.sumLineTotals(matchingItems);
      }

      const hasApplicable = (dto.category_ids || []).some((cid) =>
        couponCategoryIds.includes(Number(cid)),
      );
      return hasApplicable ? dto.cart_subtotal : 0;
    }

    return dto.cart_subtotal;
  }

  private getCouponItemCategoryIds(item: any): number[] {
    const categoryIds = Array.isArray(item.category_ids)
      ? item.category_ids
      : item.category_id
        ? [item.category_id]
        : [];

    return categoryIds
      .map((categoryId: string | number) => Number(categoryId))
      .filter((categoryId: number) => Number.isFinite(categoryId));
  }

  private sumLineTotals(items: Array<{ line_total: number }>): number {
    return items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  }

  async getStats() {
    const [total, active, usageStats] = await Promise.all([
      this.prisma.coupons.count(),
      this.prisma.coupons.count({ where: { is_active: true } }),
      this.prisma.coupon_uses.aggregate({
        _count: true,
        _sum: { discount_applied: true },
      }),
    ]);

    return {
      total_coupons: total,
      active_coupons: active,
      total_uses: usageStats._count || 0,
      total_discount_applied: Number(usageStats._sum?.discount_applied || 0),
    };
  }

  async registerUse(
    couponId: number,
    orderId: number,
    customerId: number | null,
    discountApplied: number,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.coupon_uses.create({
        data: {
          coupon_id: couponId,
          order_id: orderId,
          customer_id: customerId,
          discount_applied: discountApplied,
        },
      });

      await tx.coupons.update({
        where: { id: couponId },
        data: {
          current_uses: { increment: 1 },
        },
      });
    });
  }
}
