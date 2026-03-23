import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateCreditDto, RegisterInstallmentPaymentDto, CreditQueryDto, CancelCreditDto } from './dto';
import { calculateSchedule } from './utils/schedule-calculator';
import { canTransition } from './utils/credit-state-machine';
import { Prisma } from '@prisma/client';

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  async createCredit(dto: CreateCreditDto) {
    const context = RequestContextService.getContext()!!;

    // 1. Validate order
    const order = await this.prisma.orders.findFirst({ where: { id: dto.order_id } });
    if (!order) throw new NotFoundException('Order not found');

    // 2. Validate customer
    const customer = await this.prisma.users.findFirst({ where: { id: dto.customer_id } });
    if (!customer) throw new NotFoundException('Customer not found');

    // 3. Validate credit limit
    if (customer.credit_limit) {
      const active_credits = await this.prisma.credits.findMany({
        where: {
          customer_id: dto.customer_id,
          state: { in: ['active', 'overdue', 'pending'] },
        },
        select: { remaining_balance: true },
      });
      const total_active = active_credits.reduce(
        (sum, c) => sum + Number(c.remaining_balance), 0,
      );
      const new_total = total_active + Number(order.grand_total);
      if (new_total > Number(customer.credit_limit)) {
        throw new BadRequestException(
          `Credit limit exceeded. Available: ${Number(customer.credit_limit) - total_active}, Requested: ${Number(order.grand_total)}`,
        );
      }
    }

    // 4. Calculate schedule
    const total_amount = Number(order.grand_total) - (dto.initial_payment || 0);
    const schedule = calculateSchedule({
      total_amount,
      num_installments: dto.num_installments,
      frequency: dto.frequency,
      first_installment_date: new Date(dto.first_installment_date),
      interest_rate: dto.interest_rate || 0,
    });

    // 5. Generate credit number
    const store = await this.prisma.stores.findFirst({ where: { id: context.store_id } });
    const year = new Date().getFullYear();
    const count = await this.prisma.credits.count() + 1;
    const credit_number = `CR-${store?.store_code || 'XX'}-${year}-${String(count).padStart(4, '0')}`;

    // 6. Create credit + installments in transaction
    const total_with_interest = schedule.reduce((sum, s) => sum + s.installment_value, 0);
    const installment_value = schedule.length > 0 ? schedule[0].installment_value : 0;

    const credit = await this.prisma.$transaction(async (tx: any) => {
      const new_credit = await tx.credits.create({
        data: {
          store_id: context.store_id,
          order_id: dto.order_id,
          customer_id: dto.customer_id,
          credit_number,
          total_amount: new Prisma.Decimal(total_with_interest),
          total_paid: new Prisma.Decimal(0),
          remaining_balance: new Prisma.Decimal(total_with_interest),
          num_installments: dto.num_installments,
          installment_value: new Prisma.Decimal(installment_value),
          frequency: dto.frequency as any,
          interest_rate: dto.interest_rate ? new Prisma.Decimal(dto.interest_rate) : new Prisma.Decimal(0),
          start_date: new Date(),
          first_installment_date: new Date(dto.first_installment_date),
          state: 'pending',
          default_payment_method_id: dto.default_payment_method_id || null,
          notes: dto.notes || null,
          created_by_user_id: context.user_id || null,
        },
      });

      // Create installments
      for (const item of schedule) {
        await tx.credit_installments.create({
          data: {
            credit_id: new_credit.id,
            installment_number: item.installment_number,
            installment_value: new Prisma.Decimal(item.installment_value),
            capital_value: new Prisma.Decimal(item.capital_value),
            interest_value: new Prisma.Decimal(item.interest_value),
            amount_paid: new Prisma.Decimal(0),
            remaining_balance: new Prisma.Decimal(item.installment_value),
            due_date: item.due_date,
            state: 'pending',
          },
        });
      }

      // 7. Transition order to finished
      await tx.orders.update({
        where: { id: dto.order_id },
        data: { state: 'finished' },
      });

      return new_credit;
    });

    // 8. Handle initial payment
    if (dto.initial_payment && dto.initial_payment > 0) {
      const first_installment = await this.prisma.credit_installments.findFirst({
        where: { credit_id: credit.id, installment_number: 1 },
      });
      if (first_installment) {
        await this.registerPayment(credit.id, {
          installment_id: first_installment.id,
          amount: dto.initial_payment,
          store_payment_method_id: dto.initial_payment_method_id,
        });
      }
    }

    // 9. Emit event
    this.event_emitter.emit('credit.created', {
      credit_id: credit.id,
      store_id: context.store_id,
      customer_id: dto.customer_id,
      order_id: dto.order_id,
      total_amount: total_with_interest,
      credit_number,
    });

    return this.findOne(credit.id);
  }

  async createCreditFromPos(order_id: number, customer_id: number, installment_terms: any) {
    return this.createCredit({
      order_id,
      customer_id,
      num_installments: installment_terms.num_installments,
      frequency: installment_terms.frequency,
      first_installment_date: installment_terms.first_installment_date,
      interest_rate: installment_terms.interest_rate,
      initial_payment: installment_terms.initial_payment,
      initial_payment_method_id: installment_terms.initial_payment_method_id,
      default_payment_method_id: undefined,
    });
  }

  async findAll(query: CreditQueryDto) {
    const { page = 1, limit = 10, search, state, customer_id } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (state) where.state = state;
    if (customer_id) where.customer_id = customer_id;
    if (search) {
      where.OR = [
        { credit_number: { contains: search, mode: 'insensitive' } },
        { customer: { first_name: { contains: search, mode: 'insensitive' } } },
        { customer: { last_name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.credits.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customer: { select: { id: true, first_name: true, last_name: true, phone: true } },
          installments: {
            select: { id: true, installment_number: true, state: true, due_date: true, installment_value: true, amount_paid: true },
            orderBy: { installment_number: 'asc' },
          },
        },
      }),
      this.prisma.credits.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  }

  async getStats() {
    const now = new Date();
    const start_of_month = new Date(now.getFullYear(), now.getMonth(), 1);

    const [active_credits, total_pending, overdue_installments, monthly_collection] = await Promise.all([
      this.prisma.credits.count({ where: { state: { in: ['active', 'pending'] } } }),
      this.prisma.credits.aggregate({
        where: { state: { in: ['active', 'pending', 'overdue'] } },
        _sum: { remaining_balance: true },
      }),
      this.prisma.credit_installments.count({
        where: { state: 'overdue' },
      }),
      this.prisma.credit_installment_payments.aggregate({
        where: { payment_date: { gte: start_of_month } },
        _sum: { amount_paid: true },
      }),
    ]);

    return {
      active_credits,
      total_pending: Number(total_pending._sum.remaining_balance || 0),
      overdue_installments,
      monthly_collection: Number(monthly_collection._sum.amount_paid || 0),
    };
  }

  async findOne(id: number) {
    const credit = await this.prisma.credits.findFirst({
      where: { id },
      include: {
        customer: { select: { id: true, first_name: true, last_name: true, phone: true, email: true, credit_limit: true } },
        orders: { select: { id: true, order_number: true, grand_total: true } },
        default_payment_method: true,
        created_by: { select: { id: true, first_name: true, last_name: true } },
        installments: {
          orderBy: { installment_number: 'asc' },
          include: {
            credit_installment_payments: {
              orderBy: { payment_date: 'desc' },
              include: {
                store_payment_methods: { select: { id: true, display_name: true } },
                registered_by: { select: { id: true, first_name: true, last_name: true } },
              },
            },
          },
        },
      },
    });

    if (!credit) throw new NotFoundException('Credit not found');
    return credit;
  }

  async registerPayment(credit_id: number, dto: RegisterInstallmentPaymentDto) {
    const context = RequestContextService.getContext()!;

    const credit = await this.prisma.credits.findFirst({ where: { id: credit_id } });
    if (!credit) throw new NotFoundException('Credit not found');

    const installment = await this.prisma.credit_installments.findFirst({
      where: { id: dto.installment_id, credit_id },
    });
    if (!installment) throw new NotFoundException('Installment not found');

    if (dto.amount > Number(installment.remaining_balance)) {
      throw new BadRequestException(
        `Amount exceeds installment remaining balance of ${installment.remaining_balance}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      // 1. Create payment record
      const payment = await tx.credit_installment_payments.create({
        data: {
          installment_id: dto.installment_id,
          amount_paid: new Prisma.Decimal(dto.amount),
          payment_date: new Date(),
          store_payment_method_id: dto.store_payment_method_id || null,
          payment_reference: dto.payment_reference || null,
          registered_by_user_id: context.user_id || null,
          notes: dto.notes || null,
        },
      });

      // 2. Update installment
      const new_amount_paid = Number(installment.amount_paid) + dto.amount;
      const new_remaining = Number(installment.remaining_balance) - dto.amount;
      const installment_state = new_remaining <= 0.01 ? 'paid' : 'partial';

      await tx.credit_installments.update({
        where: { id: dto.installment_id },
        data: {
          amount_paid: new Prisma.Decimal(new_amount_paid),
          remaining_balance: new Prisma.Decimal(Math.max(new_remaining, 0)),
          state: installment_state,
          payment_date: installment_state === 'paid' ? new Date() : undefined,
        },
      });

      // 3. Update credit totals
      const new_credit_paid = Number(credit.total_paid) + dto.amount;
      const new_credit_remaining = Number(credit.remaining_balance) - dto.amount;

      // Check if all installments are paid/forgiven
      const pending_installments = await tx.credit_installments.count({
        where: {
          credit_id,
          state: { notIn: ['paid', 'forgiven'] },
          // Exclude the one we just updated if it's now paid
          NOT: installment_state === 'paid' ? { id: dto.installment_id } : undefined,
        },
      });

      const is_fully_paid = pending_installments === 0 || (pending_installments === 1 && installment_state === 'paid');
      let credit_state = credit.state as string;

      if (is_fully_paid && new_credit_remaining <= 0.01) {
        credit_state = 'paid';
      } else if (credit_state === 'pending') {
        credit_state = 'active';
      }

      await tx.credits.update({
        where: { id: credit_id },
        data: {
          total_paid: new Prisma.Decimal(new_credit_paid),
          remaining_balance: new Prisma.Decimal(Math.max(new_credit_remaining, 0)),
          state: credit_state as any,
          completed_at: credit_state === 'paid' ? new Date() : undefined,
        },
      });

      return { payment, credit_state };
    });

    // Emit events
    this.event_emitter.emit('installment_payment.received', {
      credit_id,
      installment_id: dto.installment_id,
      payment_id: result.payment.id,
      amount: dto.amount,
      store_id: context.store_id,
      store_payment_method_id: dto.store_payment_method_id,
      credit_number: credit.credit_number,
      installment_number: installment.installment_number,
      customer_id: Number(credit.customer_id),
      order_id: Number(credit.order_id),
    });

    if (result.credit_state === 'paid') {
      this.event_emitter.emit('credit.completed', {
        credit_id,
        store_id: context.store_id,
        credit_number: credit.credit_number,
        customer_id: Number(credit.customer_id),
      });
    }

    return this.findOne(credit_id);
  }

  async forgiveInstallment(credit_id: number, installment_id: number) {
    const credit = await this.prisma.credits.findFirst({ where: { id: credit_id } });
    if (!credit) throw new NotFoundException('Credit not found');

    const installment = await this.prisma.credit_installments.findFirst({
      where: { id: installment_id, credit_id },
    });
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.state === 'paid') throw new BadRequestException('Installment already paid');

    const forgiven_amount = Number(installment.remaining_balance);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.credit_installments.update({
        where: { id: installment_id },
        data: { state: 'forgiven', remaining_balance: new Prisma.Decimal(0) },
      });

      const new_remaining = Number(credit.remaining_balance) - forgiven_amount;

      // Check if credit is now fully resolved
      const pending = await tx.credit_installments.count({
        where: { credit_id, state: { notIn: ['paid', 'forgiven'] } },
      });

      await tx.credits.update({
        where: { id: credit_id },
        data: {
          remaining_balance: new Prisma.Decimal(Math.max(new_remaining, 0)),
          state: pending === 0 ? 'paid' : undefined,
          completed_at: pending === 0 ? new Date() : undefined,
        },
      });
    });

    return this.findOne(credit_id);
  }

  async cancelCredit(credit_id: number, dto: CancelCreditDto) {
    const credit = await this.prisma.credits.findFirst({ where: { id: credit_id } });
    if (!credit) throw new NotFoundException('Credit not found');

    if (!canTransition(credit.state, 'cancelled')) {
      throw new BadRequestException(`Cannot cancel credit in state: ${credit.state}`);
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.credits.update({
        where: { id: credit_id },
        data: {
          state: 'cancelled',
          notes: dto.reason ? `${credit.notes || ''}\nCancelled: ${dto.reason}`.trim() : credit.notes,
        },
      });

      // Cancel pending installments
      await tx.credit_installments.updateMany({
        where: { credit_id, state: { in: ['pending', 'overdue'] } },
        data: { state: 'forgiven' },
      });
    });

    return this.findOne(credit_id);
  }

  async getOverdueReport() {
    return this.prisma.credit_installments.findMany({
      where: { state: 'overdue' },
      orderBy: { due_date: 'asc' },
      include: {
        credits: {
          select: {
            id: true, credit_number: true, customer_id: true,
            customer: { select: { id: true, first_name: true, last_name: true, phone: true } },
          },
        },
      },
    });
  }

  async getUpcomingInstallments() {
    const now = new Date();
    const in_7_days = new Date();
    in_7_days.setDate(in_7_days.getDate() + 7);

    return this.prisma.credit_installments.findMany({
      where: {
        state: 'pending',
        due_date: { gte: now, lte: in_7_days },
      },
      orderBy: { due_date: 'asc' },
      include: {
        credits: {
          select: {
            id: true, credit_number: true,
            customer: { select: { id: true, first_name: true, last_name: true, phone: true } },
          },
        },
      },
    });
  }

  async getCustomerHistory(customer_id: number) {
    return this.prisma.credits.findMany({
      where: { customer_id },
      orderBy: { created_at: 'desc' },
      include: {
        installments: {
          select: { id: true, installment_number: true, state: true, due_date: true, installment_value: true, amount_paid: true },
          orderBy: { installment_number: 'asc' },
        },
        orders: { select: { id: true, order_number: true, grand_total: true } },
      },
    });
  }

  async getAvailableCredit(customer_id: number) {
    const customer = await this.prisma.users.findFirst({ where: { id: customer_id } });
    if (!customer) throw new NotFoundException('Customer not found');

    const active_credits = await this.prisma.credits.findMany({
      where: {
        customer_id,
        state: { in: ['active', 'overdue', 'pending'] },
      },
      select: { remaining_balance: true },
    });

    const total_used = active_credits.reduce((sum, c) => sum + Number(c.remaining_balance), 0);
    const credit_limit = customer.credit_limit ? Number(customer.credit_limit) : null;

    return {
      customer_id,
      credit_limit,
      total_used,
      available: credit_limit ? credit_limit - total_used : null,
      has_limit: credit_limit !== null,
    };
  }
}
