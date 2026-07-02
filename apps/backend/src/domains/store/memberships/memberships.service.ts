import { Injectable } from '@nestjs/common';
import {
  Prisma,
  membership_status_enum,
  membership_kind_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PaymentsService } from '../payments/payments.service';
import { MembershipPlansService } from '../membership-plans/membership-plans.service';
import {
  CreateMembershipDto,
  UpdateMembershipDto,
  MembershipQueryDto,
  RenewMembershipDto,
} from './dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * MembershipsService
 *
 * Store-scoped CRUD + lifecycle for memberships (`memberships`). A membership
 * binds a `customer_id` to a `plan_id` for a billing period, carries an
 * explicit status (`membership_status_enum`) and a `kind`
 * (`membership_kind_enum`: generic | gym | service) so any industry can reuse
 * the same core.
 *
 * Renewal delegates the charge to `PaymentsService.processPaymentWithOrder`
 * (which creates an order and processes payment); the accounting entry is
 * inherited from the `payment.received` event — NOT re-implemented here. On a
 * confirmed charge the period is extended one cycle and status set to `active`.
 *
 * Payment invariant (fix H3): a membership is BORN `pending_payment` with a
 * null `period_end` — it only gets a live period once a charge confirms via
 * `renew`. `reactivate` never resurrects an unpaid membership to `active`.
 *
 * Tenant scope: membership models are registered in `store_scoped_models`. This
 * service uses `withoutScope()` with an EXPLICIT `store_id` predicate on every
 * read/write (tenant-safe).
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly membershipPlansService: MembershipPlansService,
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

  private get memberships() {
    return this.prisma.withoutScope().memberships;
  }

  private get membershipPlans() {
    return this.prisma.withoutScope().membership_plans;
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * DAY_MS);
  }

  /**
   * Default `kind` for a new membership: `gym` when the store's industries
   * include `gym`, otherwise `generic`. An explicit DTO value always wins.
   */
  private async resolveDefaultKind(
    storeId: number,
  ): Promise<membership_kind_enum> {
    try {
      const store = await this.prisma.withoutScope().stores.findFirst({
        where: { id: storeId },
        select: { industries: true },
      });
      const industries = (store?.industries ?? []) as string[];
      return industries.includes('gym')
        ? membership_kind_enum.gym
        : membership_kind_enum.generic;
    } catch {
      return membership_kind_enum.generic;
    }
  }

  // ------------------------------------------------------------------ CRUD

  async create(dto: CreateMembershipDto) {
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

    // 2. Plan must exist in this store (findOne enforces store scope + throws).
    await this.membershipPlansService.findOne(dto.plan_id);

    // Fix H3: a membership is ALWAYS born `pending_payment`; the client cannot
    // pick the initial status. `period_end` stays null until the first charge
    // confirms in `renew` — there is no free/live membership without a payment.
    const kind = dto.kind ?? (await this.resolveDefaultKind(storeId));
    const periodStart = dto.period_start ? new Date(dto.period_start) : null;

    return this.memberships.create({
      data: {
        store_id: storeId,
        customer_id: dto.customer_id,
        plan_id: dto.plan_id,
        kind,
        status: membership_status_enum.pending_payment,
        period_start: periodStart,
        period_end: null,
        auto_renew: dto.auto_renew ?? false,
        notes: dto.notes ?? null,
      },
    });
  }

  async findAll(query: MembershipQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 10, status, customer_id, plan_id } =
      query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.membershipsWhereInput = {
      store_id: storeId,
      ...(status !== undefined && { status }),
      ...(customer_id !== undefined && { customer_id }),
      ...(plan_id !== undefined && { plan_id }),
    };

    const [rows, total] = await Promise.all([
      this.memberships.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.memberships.count({ where }),
    ]);

    const data = await this.attachRelations(rows, storeId);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const storeId = this.requireStoreId();
    const membership = await this.memberships.findFirst({
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

  async update(id: number, dto: UpdateMembershipDto) {
    const storeId = this.requireStoreId();
    await this.findOne(id);

    const data: Prisma.membershipsUpdateInput = {
      ...(dto.auto_renew !== undefined && { auto_renew: dto.auto_renew }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    await this.memberships.updateMany({
      where: { id, store_id: storeId },
      data,
    });
    return this.findOne(id);
  }

  // --------------------------------------------------------- State transitions

  async suspend(id: number) {
    return this.transition(id, 'suspend', membership_status_enum.suspended);
  }

  async freeze(id: number) {
    return this.transition(id, 'freeze', membership_status_enum.frozen);
  }

  async cancel(id: number) {
    return this.transition(id, 'cancel', membership_status_enum.cancelled);
  }

  /**
   * Fix H3: reactivate is valid ONLY from `suspended`/`frozen`. It restores the
   * membership to `active` only when it still has a live paid period
   * (`period_end` in the future). If the period is missing or already expired
   * (i.e. it was never paid, or has lapsed), it drops back to `pending_payment`
   * instead of granting free `active` access.
   */
  async reactivate(id: number) {
    const storeId = this.requireStoreId();
    const membership = await this.memberships.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true, period_end: true },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }

    const allowedFrom: membership_status_enum[] = [
      membership_status_enum.suspended,
      membership_status_enum.frozen,
    ];
    if (!allowedFrom.includes(membership.status)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Transición inválida: no se puede reactivar una membresía en estado "${membership.status}"`,
      );
    }

    const now = new Date();
    const hasLivePeriod =
      membership.period_end != null && membership.period_end >= now;
    const target = hasLivePeriod
      ? membership_status_enum.active
      : membership_status_enum.pending_payment;

    await this.memberships.updateMany({
      where: { id, store_id: storeId },
      data: { status: target },
    });
    return this.findOne(id);
  }

  private async transition(
    id: number,
    action: 'suspend' | 'freeze' | 'cancel',
    target: membership_status_enum,
  ) {
    const storeId = this.requireStoreId();
    const membership = await this.memberships.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }

    const allowedFrom: Record<typeof action, membership_status_enum[]> = {
      suspend: [
        membership_status_enum.active,
        membership_status_enum.frozen,
        membership_status_enum.pending_payment,
      ],
      freeze: [membership_status_enum.active],
      cancel: [
        membership_status_enum.active,
        membership_status_enum.frozen,
        membership_status_enum.suspended,
        membership_status_enum.pending_payment,
        membership_status_enum.expired,
      ],
    };

    if (!allowedFrom[action].includes(membership.status)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Transición inválida: no se puede ${action} una membresía en estado "${membership.status}"`,
      );
    }

    await this.memberships.updateMany({
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

    const membership = await this.memberships.findFirst({
      where: { id, store_id: storeId },
    });
    if (!membership) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Membresía no encontrada',
      );
    }

    const plan = await this.membershipPlansService.findOne(membership.plan_id);

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
        source: 'membership_renewal',
        membership_id: membership.id,
        plan_id: plan.id,
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

    await this.memberships.updateMany({
      where: { id, store_id: storeId },
      data: {
        status: membership_status_enum.active,
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
   * Attach `plan` and `customer` snapshots to membership rows. Because
   * membership models have SCALAR fks (no Prisma relations), we batch-fetch the
   * referenced plans/users manually.
   */
  private async attachRelations(rows: any[], storeId: number) {
    if (rows.length === 0) return rows;

    const planIds = [...new Set(rows.map((r) => r.plan_id))];
    const customerIds = [...new Set(rows.map((r) => r.customer_id))];

    const [plans, customers] = await Promise.all([
      this.membershipPlans.findMany({
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
      plan: planMap.get(r.plan_id) ?? null,
      customer: customerMap.get(r.customer_id) ?? null,
    }));
  }
}
