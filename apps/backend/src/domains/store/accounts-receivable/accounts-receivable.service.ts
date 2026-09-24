import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { lockOrderLifecycle } from '../orders/order-flow/order-lifecycle-lock.util';
import { ArQueryDto } from './dto/ar-query.dto';
import { RegisterArPaymentDto } from './dto/register-ar-payment.dto';

@Injectable()
export class AccountsReceivableService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  async findAll(query: ArQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      customer_id,
      search,
      date_from,
      date_to,
      sort_by = 'due_date',
      sort_order = 'asc',
    } = query;

    const where: any = {};

    if (status) where.status = status;
    if (customer_id) where.customer_id = customer_id;

    if (search) {
      where.OR = [
        { document_number: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            first_name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            last_name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (date_from || date_to) {
      where.due_date = {};
      if (date_from) where.due_date.gte = new Date(date_from);
      if (date_to) where.due_date.lte = new Date(date_to);
    }

    const [raw_data, total] = await Promise.all([
      this.prisma.accounts_receivable.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          ar_payments: {
            orderBy: { payment_date: 'desc' },
          },
          payment_agreements: {
            where: { state: 'active' },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.accounts_receivable.count({ where }),
    ]);

    const data = raw_data.map((r) => ({
      ...r,
      customer: r.customer
        ? {
            id: r.customer.id,
            name: `${r.customer.first_name ?? ''} ${r.customer.last_name ?? ''}`.trim(),
            email: r.customer.email,
            phone: r.customer.phone,
          }
        : null,
    }));

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

  // ─── DETAIL ────────────────────────────────────────────────
  async findOne(id: number) {
    const ar = await this.prisma.accounts_receivable.findFirst({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
        ar_payments: {
          orderBy: { payment_date: 'desc' },
        },
        payment_agreements: {
          include: {
            agreement_installments: {
              orderBy: { installment_number: 'asc' },
            },
          },
        },
      },
    });

    if (!ar) {
      throw new NotFoundException(`Cuenta por cobrar #${id} no encontrada`);
    }

    let order_installments: any[] = [];
    if (
      ar.source_id &&
      (ar.source_type === 'credit_sale' || ar.source_type === 'order')
    ) {
      order_installments = await this.prisma.order_installments.findMany({
        where: { order_id: ar.source_id },
        orderBy: { installment_number: 'asc' },
      });
    }

    return {
      ...ar,
      order_installments,
      customer: ar.customer
        ? {
            id: ar.customer.id,
            name: `${ar.customer.first_name ?? ''} ${ar.customer.last_name ?? ''}`.trim(),
            email: ar.customer.email,
            phone: ar.customer.phone,
          }
        : null,
    };
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  async getDashboard() {
    const now = new Date();
    const start_of_month = new Date(now.getFullYear(), now.getMonth(), 1);
    const seven_days_ahead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [total_pending, total_overdue, due_soon, collected_month] =
      await Promise.all([
        this.prisma.accounts_receivable.aggregate({
          where: { status: { in: ['open', 'partial'] } },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.accounts_receivable.aggregate({
          where: { status: 'overdue' },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.accounts_receivable.aggregate({
          where: {
            status: { in: ['open', 'partial'] },
            due_date: { gte: now, lte: seven_days_ahead },
          },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.ar_payments.aggregate({
          where: { payment_date: { gte: start_of_month } },
          _sum: { amount: true },
        }),
      ]);

    return {
      total_pending: {
        amount: Number(total_pending._sum.balance || 0),
        count: total_pending._count,
      },
      total_overdue: {
        amount: Number(total_overdue._sum.balance || 0),
        count: total_overdue._count,
      },
      due_soon: {
        amount: Number(due_soon._sum.balance || 0),
        count: due_soon._count,
      },
      collected_this_month: Number(collected_month._sum.amount || 0),
    };
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  async registerPayment(
    ar_id: number,
    dto: RegisterArPaymentDto,
    user_id: number,
  ) {
    const ar = await this.prisma.accounts_receivable.findFirst({
      where: { id: ar_id },
    });

    if (!ar) {
      throw new NotFoundException(`Cuenta por cobrar #${ar_id} no encontrada`);
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // OrderFlow cancellation takes this lock first. Match that order before
      // taking the AR lock, then re-read both records under serialization.
      if (ar.source_id && (ar.source_type === 'credit_sale' || ar.source_type === 'order')) {
        const order = await lockOrderLifecycle(tx, ar.source_id, ar.store_id);
        if (order.state === 'cancelled') {
          throw new BadRequestException('No se puede abonar una orden cancelada');
        }
      }

      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `ar_payment:${ar_id}`,
      );

      const currentAr = await tx.accounts_receivable.findFirst({
        where: { id: ar_id, store_id: ar.store_id },
      });
      if (!currentAr) {
        throw new NotFoundException(`Cuenta por cobrar #${ar_id} no encontrada`);
      }
      const current_balance = Number(currentAr.balance);
      if (dto.amount > current_balance) {
        throw new BadRequestException(
          `El monto del pago ($${dto.amount}) excede el saldo pendiente ($${current_balance})`,
        );
      }
      if (['paid', 'written_off', 'cancelled'].includes(currentAr.status)) {
        throw new BadRequestException(
          `No se puede registrar un pago en una cuenta con estado "${currentAr.status}"`,
        );
      }

      // 1. Create ar_payment record
      const payment = await tx.ar_payments.create({
        data: {
          accounts_receivable_id: ar_id,
          payment_id: dto.payment_id || null,
          amount: dto.amount,
          payment_date: new Date(),
          payment_method: dto.payment_method || null,
          reference: dto.reference || null,
          notes: dto.notes || null,
          created_by: user_id,
        },
      });

      // 2. Calculate new balance
      const new_paid = Number(currentAr.paid_amount) + dto.amount;
      const new_balance = Number(currentAr.original_amount) - new_paid - Number(currentAr.cancelled_amount);
      const new_status = new_balance <= 0 ? 'paid' : 'partial';

      // 3. Find next pending installment due date if installments exist
      let nextDueDate: Date | undefined;
      if (
        currentAr.source_id &&
        (currentAr.source_type === 'credit_sale' || currentAr.source_type === 'order')
      ) {
        if (!dto.payment_id) {
          let rem = dto.amount;
          const pendingInsts = await tx.order_installments.findMany({
            where: {
              order_id: currentAr.source_id,
              state: { in: ['pending', 'partial', 'overdue'] },
            },
            orderBy: { installment_number: 'asc' },
          });
          for (const inst of pendingInsts) {
            if (rem <= 0.01) break;
            const payable = Math.min(rem, Number(inst.remaining_balance));
            const newPaid = Number(inst.amount_paid) + payable;
            const newBal = Number(inst.remaining_balance) - payable;
            await tx.order_installments.update({
              where: { id: inst.id },
              data: {
                amount_paid: Math.round(newPaid * 100) / 100,
                remaining_balance: Math.round(Math.max(newBal, 0) * 100) / 100,
                state:
                  newBal <= 0.01
                    ? 'paid'
                    : inst.state === 'overdue'
                      ? 'overdue'
                      : 'partial',
                paid_at: newBal <= 0.01 ? new Date() : null,
              },
            });
            rem -= payable;
          }
        }

        const nextOrderInst = await tx.order_installments.findFirst({
          where: {
            order_id: currentAr.source_id,
            state: { in: ['pending', 'partial', 'overdue'] },
          },
          orderBy: { installment_number: 'asc' },
        });
        if (nextOrderInst) {
          nextDueDate = nextOrderInst.due_date;
        }
      }

      const nextAgreementInst = await tx.agreement_installments.findFirst({
        where: {
          payment_agreement: { accounts_receivable_id: ar_id },
          state: { not: 'paid' },
        },
        orderBy: { installment_number: 'asc' },
      });
      if (nextAgreementInst) {
        nextDueDate = nextAgreementInst.due_date;
      }

      // 4. Update AR
      const updated_ar = await tx.accounts_receivable.update({
        where: { id: ar_id, store_id: ar.store_id },
        data: {
          paid_amount: new_paid,
          balance: Math.max(new_balance, 0),
          status: new_status,
          last_payment_date: new Date(),
          ...(nextDueDate ? { due_date: nextDueDate } : {}),
        },
      });

      return { payment, ar: updated_ar };
    });

    return result;
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  async writeOff(ar_id: number, user_id: number) {
    const ar = await this.prisma.accounts_receivable.findFirst({
      where: { id: ar_id },
    });

    if (!ar) {
      throw new NotFoundException(`Cuenta por cobrar #${ar_id} no encontrada`);
    }

    if (ar.status === 'paid') {
      throw new BadRequestException(
        'No se puede castigar una cuenta ya pagada',
      );
    }

    if (ar.status === 'written_off') {
      throw new BadRequestException('Esta cuenta ya fue castigada');
    }

    const updated = await this.prisma.accounts_receivable.update({
      where: { id: ar_id },
      data: {
        status: 'written_off',
        notes:
          `${ar.notes || ''}\n[Castigada por usuario #${user_id} el ${new Date().toISOString()}]`.trim(),
      },
    });

    // Emit event for auto-entry (accounting)
    this.event_emitter.emit('ar.written_off', {
      ar_id: ar.id,
      store_id: ar.store_id,
      organization_id: ar.organization_id,
      customer_id: ar.customer_id,
      amount: Number(ar.balance),
      document_number: ar.document_number,
      user_id,
    });

    return updated;
  }

  // ─── CREATE FROM EVENT ─────────────────────────────────────
  /** Async credit-sale writer; cancellation and creation share the order lock. */
  async createCreditSaleFromEvent(data: {
    order_id: number;
    total_amount: number;
    store_id?: number;
    due_date?: Date;
  }) {
    if (!data.order_id) return null;
    // The event is not tenant authority. Resolve the order through the scoped
    // service before passing its store id to the raw lifecycle lock.
    const scopedOrder = await this.prisma.orders.findFirst({
      where: { id: data.order_id, ...(data.store_id ? { store_id: data.store_id } : {}) },
      select: { id: true, store_id: true },
    });
    if (!scopedOrder) return null;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await lockOrderLifecycle(tx, scopedOrder.id, scopedOrder.store_id);
      if (locked.state === 'cancelled') return null;

      const order = await tx.orders.findFirst({
        where: { id: scopedOrder.id, store_id: scopedOrder.store_id },
        select: {
          customer_id: true,
          order_number: true,
          stores: { select: { organization_id: true } },
        },
      });
      if (!order?.customer_id || !order.stores?.organization_id) return null;

      // No unique index exists for AR source identity. The order lock makes
      // this check + insert idempotent against concurrent event deliveries.
      const existing = await tx.accounts_receivable.findFirst({
        where: {
          store_id: scopedOrder.store_id,
          source_id: scopedOrder.id,
          source_type: { in: ['credit_sale', 'order'] },
        },
      });
      if (existing) return existing;

      const firstInstallment = data.due_date ? null : await tx.order_installments.findFirst({
        where: { order_id: scopedOrder.id },
        orderBy: { installment_number: 'asc' },
        select: { due_date: true },
      });
      return tx.accounts_receivable.create({
        data: {
          store_id: scopedOrder.store_id,
          organization_id: order.stores.organization_id,
          customer_id: order.customer_id,
          source_type: 'credit_sale',
          source_id: scopedOrder.id,
          document_number: order.order_number,
          original_amount: data.total_amount,
          paid_amount: 0,
          balance: data.total_amount,
          currency: 'COP',
          issue_date: new Date(),
          due_date: data.due_date ?? firstInstallment?.due_date ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'open',
          days_overdue: 0,
        },
      });
    });
  }

  async createFromEvent(data: {
    customer_id: number;
    source_type: string;
    source_id: number;
    document_number?: string;
    original_amount: number;
    currency?: string;
    due_date?: Date;
    notes?: string;
    organization_id: number;
    store_id: number;
  }) {
    const due_date =
      data.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.prisma.accounts_receivable.create({
      data: {
        store_id: data.store_id,
        organization_id: data.organization_id,
        customer_id: data.customer_id,
        source_type: data.source_type,
        source_id: data.source_id,
        document_number: data.document_number || null,
        original_amount: data.original_amount,
        paid_amount: 0,
        balance: data.original_amount,
        currency: data.currency || 'COP',
        issue_date: new Date(),
        due_date,
        status: 'open',
        days_overdue: 0,
        notes: data.notes || null,
      },
    });
  }
}
