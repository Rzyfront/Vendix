import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ApQueryDto } from './dto/ap-query.dto';
import { RegisterApPaymentDto } from './dto/register-ap-payment.dto';

@Injectable()
export class AccountsPayableService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  async findAll(query: ApQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      supplier_id,
      priority,
      search,
      date_from,
      date_to,
      sort_by = 'due_date',
      sort_order = 'asc',
    } = query;

    const where: any = {};

    if (status) where.status = status;
    if (supplier_id) where.supplier_id = supplier_id;
    if (priority) where.priority = priority;

    if (search) {
      where.OR = [
        { document_number: { contains: search, mode: 'insensitive' } },
        {
          supplier: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (date_from || date_to) {
      where.due_date = {};
      if (date_from) where.due_date.gte = new Date(date_from);
      if (date_to) where.due_date.lte = new Date(date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.accounts_payable.findMany({
        where,
        include: {
          supplier: {
            select: { id: true, name: true, tax_id: true, phone: true },
          },
          ap_payments: {
            orderBy: { payment_date: 'desc' },
          },
          ap_payment_schedules: {
            where: { status: 'scheduled' },
            orderBy: { scheduled_date: 'asc' },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.accounts_payable.count({ where }),
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

  // ─── DETAIL ────────────────────────────────────────────────
  async findOne(id: number) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            tax_id: true,
            phone: true,
            bank_name: true,
            bank_account_number: true,
            bank_account_type: true,
          },
        },
        ap_payments: {
          orderBy: { payment_date: 'desc' },
        },
        ap_payment_schedules: {
          orderBy: { scheduled_date: 'asc' },
        },
      },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${id} no encontrada`);
    }

    return ap;
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  async getDashboard() {
    const now = new Date();
    const start_of_month = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total_pending, total_overdue, total_scheduled, paid_month] =
      await Promise.all([
        this.prisma.accounts_payable.aggregate({
          where: { status: { in: ['open', 'partial'] } },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.accounts_payable.aggregate({
          where: { status: 'overdue' },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.ap_payment_schedules.aggregate({
          where: { status: 'scheduled' },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.ap_payments.aggregate({
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
      total_scheduled: {
        amount: Number(total_scheduled._sum.amount || 0),
        count: total_scheduled._count,
      },
      paid_this_month: Number(paid_month._sum.amount || 0),
    };
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  async registerPayment(
    ap_id: number,
    dto: RegisterApPaymentDto,
    user_id: number,
  ) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id: ap_id },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${ap_id} no encontrada`);
    }

    const current_balance = Number(ap.balance);

    if (dto.amount > current_balance) {
      throw new BadRequestException(
        `El monto del pago ($${dto.amount}) excede el saldo pendiente ($${current_balance})`,
      );
    }

    if (ap.status === 'paid' || ap.status === 'written_off') {
      throw new BadRequestException(
        `No se puede registrar un pago en una cuenta con estado "${ap.status}"`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create ap_payment record
      const payment = await tx.ap_payments.create({
        data: {
          accounts_payable_id: ap_id,
          amount: dto.amount,
          payment_date: new Date(),
          payment_method: dto.payment_method,
          reference: dto.reference || null,
          bank_export_ref: dto.bank_export_ref || null,
          notes: dto.notes || null,
          created_by: user_id,
        },
      });

      // 2. Calculate new balance
      const new_paid = Number(ap.paid_amount) + dto.amount;
      const new_balance = Number(ap.original_amount) - new_paid;
      const new_status = new_balance <= 0 ? 'paid' : 'partial';

      // 3. Update AP
      const updated_ap = await tx.accounts_payable.update({
        where: { id: ap_id },
        data: {
          paid_amount: new_paid,
          balance: Math.max(new_balance, 0),
          status: new_status,
        },
      });

      return { payment, ap: updated_ap };
    });

    // 4. Emit event for accounting entry
    this.event_emitter.emit('ap.payment_registered', {
      ap_id: ap.id,
      organization_id: ap.organization_id,
      store_id: ap.store_id,
      supplier_id: ap.supplier_id,
      amount: dto.amount,
      payment_method: dto.payment_method,
      document_number: ap.document_number,
      user_id,
    });

    return result;
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  async writeOff(ap_id: number, user_id: number) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id: ap_id },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${ap_id} no encontrada`);
    }

    if (ap.status === 'paid') {
      throw new BadRequestException(
        'No se puede castigar una cuenta ya pagada',
      );
    }

    if (ap.status === 'written_off') {
      throw new BadRequestException('Esta cuenta ya fue castigada');
    }

    const updated = await this.prisma.accounts_payable.update({
      where: { id: ap_id },
      data: {
        status: 'written_off',
        notes: `${ap.notes || ''}\n[Castigada por usuario #${user_id} el ${new Date().toISOString()}]`.trim(),
      },
    });

    // Emit event for accounting entry
    this.event_emitter.emit('ap.written_off', {
      ap_id: ap.id,
      organization_id: ap.organization_id,
      store_id: ap.store_id,
      supplier_id: ap.supplier_id,
      amount: Number(ap.balance),
      document_number: ap.document_number,
      user_id,
    });

    return updated;
  }

  // ─── CREATE FROM EVENT ─────────────────────────────────────
  async createFromEvent(data: {
    supplier_id: number;
    source_type: string;
    source_id?: number;
    document_number?: string;
    original_amount: number;
    currency?: string;
    due_date?: Date;
    priority?: string;
    notes?: string;
    organization_id: number;
    store_id?: number;
  }) {
    const due_date =
      data.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.prisma.accounts_payable.create({
      data: {
        organization_id: data.organization_id,
        store_id: data.store_id || null,
        supplier_id: data.supplier_id,
        source_type: data.source_type,
        source_id: data.source_id || null,
        document_number: data.document_number || null,
        original_amount: data.original_amount,
        paid_amount: 0,
        balance: data.original_amount,
        currency: data.currency || 'COP',
        issue_date: new Date(),
        due_date,
        status: 'open',
        days_overdue: 0,
        priority: data.priority || 'normal',
        notes: data.notes || null,
      },
    });
  }
}
