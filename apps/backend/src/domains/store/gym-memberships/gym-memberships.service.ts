import { Injectable } from '@nestjs/common';
import { Prisma, gym_membership_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PaymentsService } from '../payments/payments.service';
import { GymPlansService } from '../gym-plans/gym-plans.service';
import {
  CreateGymMembershipDto,
  UpdateGymMembershipDto,
  GymMembershipQueryDto,
  RenewMembershipDto,
} from './dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GymMembershipsService
 *
 * Store-scoped CRUD + lifecycle for gym memberships (`gym_memberships`). A
 * membership binds a `customer_id` to a `gym_plan_id` for a billing period and
 * carries an explicit status (`gym_membership_status_enum`).
 *
 * Renewal delegates the charge to `PaymentsService.processPaymentWithOrder`
 * (which creates an order and processes payment); the accounting entry is
 * inherited from the `payment.received` event — NOT re-implemented here. On a
 * confirmed charge the period is extended one cycle and status set to `active`.
 *
 * Tenant scope: `gym_*` models are registered in `store_scoped_models` but the
 * public scoped getters are not yet exposed on `StorePrismaService`. Until then
 * this service uses `withoutScope()` with an EXPLICIT `store_id` predicate on
 * every read/write (tenant-safe). Switch to the auto-scoped client once the
 * getters exist (see final report / blocker note).
 */
@Injectable()
export class GymMembershipsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly gymPlansService: GymPlansService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // ------------------------------------------------------------------ Helpers

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private get gymMemberships() {
    return this.prisma.withoutScope().gym_memberships;
  }

  private get gymPlans() {
    return this.prisma.withoutScope().gym_plans;
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * DAY_MS);
  }

  // ------------------------------------------------------------------ CRUD

  async create(dto: CreateGymMembershipDto) {
    const storeId = this.requireStoreId();

    // 1. Customer must exist.
    const customer = await this.prisma.users.findFirst({
      where: { id: dto.customer_id },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    // 2. Plan must exist in this store (findOne enforces store scope).
    const plan = await this.gymPlansService.findOne(dto.gym_plan_id);

    const periodStart = dto.period_start ? new Date(dto.period_start) : new Date();
    const periodEnd = this.addDays(periodStart, plan.duration_days ?? 30);

    return this.gymMemberships.create({
      data: {
        store_id: storeId,
        customer_id: dto.customer_id,
        gym_plan_id: dto.gym_plan_id,
        status: dto.status ?? gym_membership_status_enum.pending_payment,
        period_start: periodStart,
        period_end: periodEnd,
        auto_renew: dto.auto_renew ?? false,
        notes: dto.notes ?? null,
      },
    });
  }

  async findAll(query: GymMembershipQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 10, status, customer_id, gym_plan_id } =
      query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.gym_membershipsWhereInput = {
      store_id: storeId,
      ...(status !== undefined && { status }),
      ...(customer_id !== undefined && { customer_id }),
      ...(gym_plan_id !== undefined && { gym_plan_id }),
    };

    const [rows, total] = await Promise.all([
      this.gymMemberships.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.gymMemberships.count({ where }),
    ]);

    const data = await this.attachRelations(rows, storeId);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const storeId = this.requireStoreId();
    const membership = await this.gymMemberships.findFirst({
      where: { id, store_id: storeId },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }
    const [withRel] = await this.attachRelations([membership], storeId);
    return withRel;
  }

  async update(id: number, dto: UpdateGymMembershipDto) {
    const storeId = this.requireStoreId();
    await this.findOne(id);

    const data: Prisma.gym_membershipsUpdateInput = {
      ...(dto.auto_renew !== undefined && { auto_renew: dto.auto_renew }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    await this.gymMemberships.updateMany({
      where: { id, store_id: storeId },
      data,
    });
    return this.findOne(id);
  }

  // --------------------------------------------------------- State transitions

  async suspend(id: number) {
    return this.transition(id, 'suspend', gym_membership_status_enum.suspended);
  }

  async freeze(id: number) {
    return this.transition(id, 'freeze', gym_membership_status_enum.frozen);
  }

  async cancel(id: number) {
    return this.transition(id, 'cancel', gym_membership_status_enum.cancelled);
  }

  async reactivate(id: number) {
    return this.transition(
      id,
      'reactivate',
      gym_membership_status_enum.active,
    );
  }

  private async transition(
    id: number,
    action: 'suspend' | 'freeze' | 'cancel' | 'reactivate',
    target: gym_membership_status_enum,
  ) {
    const storeId = this.requireStoreId();
    const membership = await this.gymMemberships.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }

    const allowedFrom: Record<
      typeof action,
      gym_membership_status_enum[]
    > = {
      suspend: [
        gym_membership_status_enum.active,
        gym_membership_status_enum.frozen,
        gym_membership_status_enum.pending_payment,
      ],
      freeze: [gym_membership_status_enum.active],
      cancel: [
        gym_membership_status_enum.active,
        gym_membership_status_enum.frozen,
        gym_membership_status_enum.suspended,
        gym_membership_status_enum.pending_payment,
        gym_membership_status_enum.expired,
      ],
      reactivate: [
        gym_membership_status_enum.suspended,
        gym_membership_status_enum.frozen,
      ],
    };

    if (!allowedFrom[action].includes(membership.status)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Transición inválida: no se puede ${action} una membresía en estado "${membership.status}"`,
      );
    }

    await this.gymMemberships.updateMany({
      where: { id, store_id: storeId },
      data: { status: target },
    });
    return this.findOne(id);
  }

  // ----------------------------------------------------------------- Renewal

  /**
   * Renew a membership: create an order for the plan and charge it via
   * `PaymentsService.processPaymentWithOrder` (cash/card/transfer at reception).
   * On a confirmed charge, extend `period_end` one cycle, set `status='active'`
   * and persist `source_order_id`. The journal entry is emitted by the
   * downstream `payment.received` event.
   *
   * For asynchronous methods that settle later (e.g. online gateway pending),
   * the period is NOT extended synchronously — the membership stays as-is until
   * the payment confirms.
   */
  async renew(id: number, dto: RenewMembershipDto, user: any) {
    const storeId = this.requireStoreId();

    const membership = await this.gymMemberships.findFirst({
      where: { id, store_id: storeId },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }

    const plan = await this.gymPlansService.findOne(membership.gym_plan_id);

    const amount = dto.amount ?? Number(plan.price);
    const currency = dto.currency ?? plan.currency ?? 'COP';

    const customer = await this.prisma.users.findFirst({
      where: { id: membership.customer_id },
      select: { first_name: true, last_name: true, email: true, phone: true },
    });

    const customerName =
      dto.customer_name ??
      `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim();

    // Order line: backed by the plan's product when set, otherwise ad-hoc.
    const items: any[] =
      plan.product_id != null
        ? [
            {
              productId: plan.product_id,
              productName: plan.name,
              quantity: 1,
              unitPrice: amount,
              totalPrice: amount,
            },
          ]
        : [
            {
              productName: `Membresía: ${plan.name}`,
              quantity: 1,
              unitPrice: amount,
              totalPrice: amount,
            },
          ];

    const payload = {
      // orderId is ignored by processPaymentWithNewOrder (it creates a fresh
      // order and overwrites this field with the new order id).
      orderId: 0,
      storeId,
      customerId: membership.customer_id,
      amount,
      currency,
      storePaymentMethodId: dto.store_payment_method_id,
      customerEmail: dto.customer_email ?? customer?.email ?? '',
      customerName: customerName || 'Socio',
      customerPhone: dto.customer_phone ?? customer?.phone ?? undefined,
      items,
      metadata: {
        source: 'gym_membership_renewal',
        membership_id: membership.id,
        gym_plan_id: plan.id,
      },
    };

    const paymentResult: any = await this.paymentsService.processPaymentWithOrder(
      payload as any,
      user,
    );

    const status: string | undefined = paymentResult?.data?.status;
    const confirmed = status === 'succeeded' || status === 'captured';

    if (!confirmed) {
      // Async / pending payment: leave the membership untouched. The period
      // extension happens only when the charge is confirmed.
      return {
        membership: await this.findOne(id),
        payment: paymentResult,
        renewed: false,
      };
    }

    // Resolve the freshly-created order id from the payment record.
    let sourceOrderId: number | null = membership.source_order_id ?? null;
    const txnId: string | undefined =
      paymentResult?.data?.transactionId ??
      paymentResult?.data?.gatewayReference;
    if (txnId) {
      const pay = await this.prisma.withoutScope().payments.findFirst({
        where: {
          OR: [{ transaction_id: txnId }, { gateway_reference: txnId }],
        },
        select: { order_id: true },
        orderBy: { id: 'desc' },
      });
      if (pay?.order_id != null) sourceOrderId = pay.order_id;
    }

    // Extend from the later of "now" and the current period end.
    const now = new Date();
    const base =
      membership.period_end && membership.period_end > now
        ? membership.period_end
        : now;
    const newEnd = this.addDays(base, plan.duration_days ?? 30);

    await this.gymMemberships.updateMany({
      where: { id, store_id: storeId },
      data: {
        status: gym_membership_status_enum.active,
        period_start: membership.period_start ?? now,
        period_end: newEnd,
        ...(sourceOrderId != null && { source_order_id: sourceOrderId }),
      },
    });

    return {
      membership: await this.findOne(id),
      payment: paymentResult,
      renewed: true,
    };
  }

  // ------------------------------------------------------------------ Internals

  /**
   * Attach `plan` and `customer` snapshots to membership rows. Because gym
   * models have SCALAR fks (no Prisma relations), we batch-fetch the referenced
   * plans/users manually.
   */
  private async attachRelations(rows: any[], storeId: number) {
    if (rows.length === 0) return rows;

    const planIds = [...new Set(rows.map((r) => r.gym_plan_id))];
    const customerIds = [...new Set(rows.map((r) => r.customer_id))];

    const [plans, customers] = await Promise.all([
      this.gymPlans.findMany({
        where: { id: { in: planIds }, store_id: storeId },
        select: {
          id: true,
          code: true,
          name: true,
          price: true,
          currency: true,
          duration_days: true,
        },
      }),
      this.prisma.users.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
        },
      }),
    ]);

    const planMap = new Map(plans.map((p) => [p.id, p]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return rows.map((r) => ({
      ...r,
      plan: planMap.get(r.gym_plan_id) ?? null,
      customer: customerMap.get(r.customer_id) ?? null,
    }));
  }
}
