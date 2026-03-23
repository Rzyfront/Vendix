import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateAdvanceDto, ApproveAdvanceDto, QueryAdvanceDto, RegisterAdvancePaymentDto } from './dto';
import { validateAdvanceTransition } from './utils/advance-state-machine';

const ADVANCE_INCLUDE = {
  employee: {
    select: { id: true, first_name: true, last_name: true, employee_code: true },
  },
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  advance_payments: {
    orderBy: { created_at: 'desc' as const },
  },
};

@Injectable()
export class AdvancesService {
  private readonly logger = new Logger(AdvancesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // ─── CRUD ────────────────────────────────────────────

  async create(dto: CreateAdvanceDto) {
    const context = this.getContext();

    // Validate employee exists and is active
    const employee = await this.prisma.employees.findFirst({
      where: { id: dto.employee_id, status: 'active' },
    });
    if (!employee) {
      throw new VendixHttpException(ErrorCodes.ADV_VALIDATE_001);
    }

    // Generate advance_number: ADV-{YEAR}-{PADDED_SEQ}
    const year = new Date().getFullYear();
    const count = await this.prisma.employee_advances.count({
      where: { organization_id: context.organization_id },
    });
    const advance_number = `ADV-${year}-${String(count + 1).padStart(5, '0')}`;

    const advance = await this.prisma.employee_advances.create({
      data: {
        organization_id: context.organization_id,
        employee_id: dto.employee_id,
        advance_number,
        amount_requested: new Prisma.Decimal(dto.amount_requested),
        amount_approved: new Prisma.Decimal(0),
        amount_paid: new Prisma.Decimal(0),
        amount_pending: new Prisma.Decimal(dto.amount_requested),
        installments: dto.installments,
        installment_value: new Prisma.Decimal(0),
        frequency: (dto.frequency || 'monthly') as any,
        status: 'pending',
        advance_date: new Date(dto.advance_date),
        reason: dto.reason || null,
      },
      include: ADVANCE_INCLUDE,
    });

    this.logger.log(`Advance ${advance_number} created for employee #${dto.employee_id}`);
    return advance;
  }

  async findAll(query: QueryAdvanceDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      employee_id,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.employee_advancesWhereInput = {
      ...(search && {
        OR: [
          { advance_number: { contains: search, mode: 'insensitive' as const } },
          { employee: { first_name: { contains: search, mode: 'insensitive' as const } } },
          { employee: { last_name: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(employee_id && { employee_id }),
    };

    const [data, total] = await Promise.all([
      this.prisma.employee_advances.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: ADVANCE_INCLUDE,
      }),
      this.prisma.employee_advances.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const advance = await this.prisma.employee_advances.findFirst({
      where: { id },
      include: ADVANCE_INCLUDE,
    });

    if (!advance) {
      throw new VendixHttpException(ErrorCodes.ADV_FIND_001);
    }

    return advance;
  }

  // ─── STATE TRANSITIONS ───────────────────────────────

  async approve(id: number, dto: ApproveAdvanceDto) {
    const context = this.getContext();
    const advance = await this.findOne(id);

    if (!validateAdvanceTransition(advance.status, 'approved')) {
      throw new VendixHttpException(ErrorCodes.ADV_STATUS_001);
    }

    const amount_approved = dto.amount_approved || Number(advance.amount_requested);
    const installments = dto.installments || advance.installments;
    const installment_value = this.round(amount_approved / installments);

    const updated = await this.prisma.employee_advances.update({
      where: { id },
      data: {
        status: 'approved',
        amount_approved: new Prisma.Decimal(amount_approved),
        amount_pending: new Prisma.Decimal(amount_approved),
        installments,
        installment_value: new Prisma.Decimal(installment_value),
        approved_by_user_id: context.user_id || null,
        approved_at: new Date(),
        notes: dto.notes || advance.notes,
      },
      include: ADVANCE_INCLUDE,
    });

    this.logger.log(`Advance #${id} approved for ${amount_approved}`);
    return updated;
  }

  async reject(id: number) {
    const advance = await this.findOne(id);

    if (!validateAdvanceTransition(advance.status, 'rejected')) {
      throw new VendixHttpException(ErrorCodes.ADV_STATUS_001);
    }

    const updated = await this.prisma.employee_advances.update({
      where: { id },
      data: { status: 'rejected' },
      include: ADVANCE_INCLUDE,
    });

    this.logger.log(`Advance #${id} rejected`);
    return updated;
  }

  async cancel(id: number) {
    const advance = await this.findOne(id);

    if (!validateAdvanceTransition(advance.status, 'cancelled')) {
      throw new VendixHttpException(ErrorCodes.ADV_STATUS_001);
    }

    const updated = await this.prisma.employee_advances.update({
      where: { id },
      data: { status: 'cancelled' },
      include: ADVANCE_INCLUDE,
    });

    this.logger.log(`Advance #${id} cancelled`);
    return updated;
  }

  // ─── PAYMENTS ────────────────────────────────────────

  async registerManualPayment(id: number, dto: RegisterAdvancePaymentDto) {
    const advance = await this.findOne(id);

    // Validate amount does not exceed pending
    const current_pending = Number(advance.amount_pending);
    if (dto.amount > current_pending) {
      throw new VendixHttpException(ErrorCodes.ADV_PAYMENT_001);
    }

    // Must be in approved or repaying state
    if (!['approved', 'repaying'].includes(advance.status)) {
      throw new VendixHttpException(ErrorCodes.ADV_STATUS_001);
    }

    const new_amount_paid = this.round(Number(advance.amount_paid) + dto.amount);
    const new_amount_pending = this.round(current_pending - dto.amount);
    const new_status = new_amount_pending <= 0 ? 'paid' : 'repaying';

    const updated = await this.prisma.$transaction(async (tx: any) => {
      // Create payment record
      await tx.employee_advance_payments.create({
        data: {
          advance_id: id,
          amount: new Prisma.Decimal(dto.amount),
          payment_date: new Date(dto.payment_date),
          payment_type: 'manual',
          notes: dto.notes || null,
        },
      });

      // Update advance balances
      return tx.employee_advances.update({
        where: { id },
        data: {
          amount_paid: new Prisma.Decimal(new_amount_paid),
          amount_pending: new Prisma.Decimal(new_amount_pending),
          status: new_status as any,
          ...(new_status === 'paid' && { completed_at: new Date() }),
        },
        include: ADVANCE_INCLUDE,
      });
    });

    this.logger.log(`Manual payment of ${dto.amount} registered for advance #${id}. Status: ${new_status}`);
    return updated;
  }

  // ─── PAYROLL INTEGRATION ─────────────────────────────

  /**
   * Calculate total deduction for an employee's active advances.
   * Called by PayrollCalculationService to get the installment amount.
   */
  async calculateDeductionForPayroll(employee_id: number): Promise<number> {
    const advances = await this.prisma.employee_advances.findMany({
      where: {
        employee_id,
        status: { in: ['approved', 'repaying'] },
      },
      select: { installment_value: true, amount_pending: true },
    });

    let total = 0;
    for (const advance of advances) {
      // Deduct installment_value or remaining amount_pending, whichever is less
      const deduction = Math.min(
        Number(advance.installment_value),
        Number(advance.amount_pending),
      );
      total += deduction;
    }

    return this.round(total);
  }

  /**
   * Apply a payroll deduction to an employee's active advances (FIFO order).
   * Called after payroll items are created.
   */
  async applyPayrollDeduction(
    employee_id: number,
    payroll_item_id: number,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) return;

    const advances = await this.prisma.employee_advances.findMany({
      where: {
        employee_id,
        status: { in: ['approved', 'repaying'] },
      },
      orderBy: { advance_date: 'asc' }, // FIFO
    });

    let remaining = amount;

    await this.prisma.$transaction(async (tx: any) => {
      for (const advance of advances) {
        if (remaining <= 0) break;

        const pending = Number(advance.amount_pending);
        const payment_amount = this.round(Math.min(remaining, pending));
        remaining = this.round(remaining - payment_amount);

        const new_amount_paid = this.round(Number(advance.amount_paid) + payment_amount);
        const new_amount_pending = this.round(pending - payment_amount);
        const new_status = new_amount_pending <= 0 ? 'paid' : 'repaying';

        // Create payment record linked to payroll item
        await tx.employee_advance_payments.create({
          data: {
            advance_id: advance.id,
            payroll_item_id,
            amount: new Prisma.Decimal(payment_amount),
            payment_date: new Date(),
            payment_type: 'payroll_deduction',
            notes: `Payroll deduction - item #${payroll_item_id}`,
          },
        });

        // Update advance balances
        await tx.employee_advances.update({
          where: { id: advance.id },
          data: {
            amount_paid: new Prisma.Decimal(new_amount_paid),
            amount_pending: new Prisma.Decimal(new_amount_pending),
            status: new_status as any,
            ...(new_status === 'paid' && { completed_at: new Date() }),
          },
        });

        this.logger.log(
          `Payroll deduction of ${payment_amount} applied to advance #${advance.id}. ` +
            `New pending: ${new_amount_pending}. Status: ${new_status}`,
        );
      }
    });
  }

  // ─── STATS ───────────────────────────────────────────

  async getStats() {
    const [
      total_active,
      total_pending_approval,
      active_advances,
      month_payments,
    ] = await Promise.all([
      this.prisma.employee_advances.count({
        where: { status: { in: ['approved', 'repaying'] } },
      }),
      this.prisma.employee_advances.count({
        where: { status: 'pending' },
      }),
      this.prisma.employee_advances.findMany({
        where: { status: { in: ['approved', 'repaying'] } },
        select: { amount_pending: true },
      }),
      this.prisma.employee_advance_payments.findMany({
        where: {
          created_at: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        select: { amount: true },
      }),
    ]);

    const total_amount_pending = active_advances.reduce(
      (sum, a) => sum + Number(a.amount_pending),
      0,
    );
    const total_deducted_this_month = month_payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    return {
      total_active,
      total_pending_approval,
      total_amount_pending: this.round(total_amount_pending),
      total_deducted_this_month: this.round(total_deducted_this_month),
    };
  }

  async getEmployeeAdvanceSummary(employee_id: number) {
    const advances = await this.prisma.employee_advances.findMany({
      where: {
        employee_id,
        status: { in: ['approved', 'repaying'] },
      },
      select: { amount_pending: true, installment_value: true },
    });

    const total_pending = advances.reduce(
      (sum, a) => sum + Number(a.amount_pending),
      0,
    );
    const monthly_deduction = advances.reduce(
      (sum, a) => sum + Math.min(Number(a.installment_value), Number(a.amount_pending)),
      0,
    );

    return {
      active_advances: advances.length,
      total_pending: this.round(total_pending),
      monthly_deduction: this.round(monthly_deduction),
    };
  }
}
