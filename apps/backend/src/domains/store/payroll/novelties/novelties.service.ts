import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateNoveltyDto, QueryNoveltyDto, UpdateNoveltyDto } from './dto';

const NOVELTY_INCLUDE = {
  employee: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      employee_code: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  payroll_run: {
    select: { id: true, payroll_number: true, status: true },
  },
};

/** Novelty types valued by the hour (require `hours`). */
const HOURS_REQUIRED_TYPES = new Set([
  'overtime_diurna',
  'overtime_nocturna',
  'overtime_dominical_diurna',
  'overtime_dominical_nocturna',
  'surcharge_nocturno',
  'surcharge_dominical',
]);

/** Novelty types valued by the day (require `days`). */
const DAYS_REQUIRED_TYPES = new Set([
  'incapacity_general',
  'incapacity_laboral',
  'vacation',
  'leave_paid',
  'leave_unpaid',
]);

/** Novelty types with a manual amount (require `amount`). */
const AMOUNT_REQUIRED_TYPES = new Set([
  'bonus',
  'commission',
  'other_deduction',
]);

@Injectable()
export class NoveltiesService {
  private readonly logger = new Logger(NoveltiesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Business validation: each novelty type requires its quantity field
   * (hours, days or amount) so it can be valued at calculation time.
   */
  private validateQuantityForType(novelty: {
    novelty_type: string;
    hours?: number | null;
    days?: number | null;
    amount?: number | null;
  }): void {
    const { novelty_type } = novelty;
    const hours = Number(novelty.hours ?? 0);
    const days = Number(novelty.days ?? 0);
    const amount = Number(novelty.amount ?? 0);

    if (HOURS_REQUIRED_TYPES.has(novelty_type) && hours <= 0) {
      throw new VendixHttpException(
        ErrorCodes.NOV_VALIDATE_002,
        `Novelty type '${novelty_type}' requires 'hours' > 0`,
      );
    }
    if (DAYS_REQUIRED_TYPES.has(novelty_type) && days <= 0) {
      throw new VendixHttpException(
        ErrorCodes.NOV_VALIDATE_002,
        `Novelty type '${novelty_type}' requires 'days' > 0`,
      );
    }
    if (AMOUNT_REQUIRED_TYPES.has(novelty_type) && amount <= 0) {
      throw new VendixHttpException(
        ErrorCodes.NOV_VALIDATE_002,
        `Novelty type '${novelty_type}' requires 'amount' > 0`,
      );
    }
  }

  // ─── CRUD ────────────────────────────────────────────

  async create(dto: CreateNoveltyDto) {
    const context = this.getContext();

    const employee = await this.prisma.employees.findFirst({
      where: { id: dto.employee_id, status: 'active' },
    });
    if (!employee) {
      throw new VendixHttpException(ErrorCodes.NOV_VALIDATE_001);
    }

    this.validateQuantityForType(dto);

    const novelty = await this.prisma.payroll_novelties.create({
      data: {
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
        employee_id: dto.employee_id,
        novelty_type: dto.novelty_type as any,
        status: 'pending',
        date_start: new Date(dto.date_start),
        date_end: dto.date_end ? new Date(dto.date_end) : null,
        hours: dto.hours != null ? new Prisma.Decimal(dto.hours) : null,
        days: dto.days != null ? new Prisma.Decimal(dto.days) : null,
        percentage:
          dto.percentage != null ? new Prisma.Decimal(dto.percentage) : null,
        amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null,
        notes: dto.notes ?? null,
        created_by_user_id: context.user_id ?? null,
      },
      include: NOVELTY_INCLUDE,
    });

    this.logger.log(
      `Novelty #${novelty.id} (${dto.novelty_type}) created for employee #${dto.employee_id}`,
    );
    return novelty;
  }

  async findAll(query: QueryNoveltyDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'date_start',
      sort_order = 'desc',
      employee_id,
      novelty_type,
      status,
      date_from,
      date_to,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.payroll_noveltiesWhereInput = {
      ...(search && {
        OR: [
          {
            employee: {
              first_name: { contains: search, mode: 'insensitive' as const },
            },
          },
          {
            employee: {
              last_name: { contains: search, mode: 'insensitive' as const },
            },
          },
          { notes: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(employee_id && { employee_id }),
      ...(novelty_type && { novelty_type: novelty_type as any }),
      ...(status && { status: status as any }),
      ...(date_from && { date_start: { gte: new Date(date_from) } }),
      ...(date_to && {
        date_start: {
          ...(date_from ? { gte: new Date(date_from) } : {}),
          lte: new Date(date_to + 'T23:59:59.999Z'),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.payroll_novelties.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: NOVELTY_INCLUDE,
      }),
      this.prisma.payroll_novelties.count({ where }),
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
    const novelty = await this.prisma.payroll_novelties.findFirst({
      where: { id },
      include: NOVELTY_INCLUDE,
    });

    if (!novelty) {
      throw new VendixHttpException(ErrorCodes.NOV_FIND_001);
    }

    return novelty;
  }

  async update(id: number, dto: UpdateNoveltyDto) {
    const novelty = await this.findOne(id);

    if (novelty.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.NOV_STATUS_001,
        `Novelty #${id} is '${novelty.status}'. Only pending novelties can be updated.`,
      );
    }

    if (dto.employee_id && dto.employee_id !== novelty.employee_id) {
      const employee = await this.prisma.employees.findFirst({
        where: { id: dto.employee_id, status: 'active' },
      });
      if (!employee) {
        throw new VendixHttpException(ErrorCodes.NOV_VALIDATE_001);
      }
    }

    // Validate the merged state (DTO overrides current values)
    this.validateQuantityForType({
      novelty_type: dto.novelty_type ?? novelty.novelty_type,
      hours: dto.hours ?? (novelty.hours != null ? Number(novelty.hours) : null),
      days: dto.days ?? (novelty.days != null ? Number(novelty.days) : null),
      amount:
        dto.amount ?? (novelty.amount != null ? Number(novelty.amount) : null),
    });

    const updated = await this.prisma.payroll_novelties.update({
      where: { id },
      data: {
        ...(dto.employee_id != null && { employee_id: dto.employee_id }),
        ...(dto.novelty_type != null && {
          novelty_type: dto.novelty_type as any,
        }),
        ...(dto.date_start != null && { date_start: new Date(dto.date_start) }),
        ...(dto.date_end !== undefined && {
          date_end: dto.date_end ? new Date(dto.date_end) : null,
        }),
        ...(dto.hours !== undefined && {
          hours: dto.hours != null ? new Prisma.Decimal(dto.hours) : null,
        }),
        ...(dto.days !== undefined && {
          days: dto.days != null ? new Prisma.Decimal(dto.days) : null,
        }),
        ...(dto.percentage !== undefined && {
          percentage:
            dto.percentage != null ? new Prisma.Decimal(dto.percentage) : null,
        }),
        ...(dto.amount !== undefined && {
          amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
        updated_at: new Date(),
      },
      include: NOVELTY_INCLUDE,
    });

    this.logger.log(`Novelty #${id} updated`);
    return updated;
  }

  async remove(id: number) {
    const novelty = await this.findOne(id);

    if (novelty.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.NOV_STATUS_001,
        `Novelty #${id} is '${novelty.status}'. Only pending novelties can be deleted.`,
      );
    }

    await this.prisma.payroll_novelties.delete({ where: { id } });

    this.logger.log(`Novelty #${id} deleted`);
    return { id };
  }

  // ─── PAYROLL INTEGRATION ─────────────────────────────

  /**
   * Pending novelties whose dates overlap the payroll period for the given
   * employees. A novelty without date_end is treated as a point-in-time
   * event at date_start.
   */
  async findPendingForPeriod(
    employee_ids: number[],
    period_start: Date,
    period_end: Date,
  ) {
    if (employee_ids.length === 0) return [];

    return this.prisma.payroll_novelties.findMany({
      where: {
        employee_id: { in: employee_ids },
        status: 'pending',
        date_start: { lte: period_end },
        OR: [
          { date_end: { gte: period_start } },
          { date_end: null, date_start: { gte: period_start } },
        ],
      },
      orderBy: { date_start: 'asc' },
    });
  }

  /**
   * Marks the given novelties as applied to a payroll run.
   * Runs inside the caller's transaction (tx) so the attach is atomic with
   * the payroll items persistence.
   */
  async attachToRun(
    tx: any,
    novelty_ids: number[],
    payroll_run_id: number,
  ): Promise<void> {
    if (novelty_ids.length === 0) return;

    await tx.payroll_novelties.updateMany({
      where: { id: { in: novelty_ids } },
      data: {
        status: 'applied',
        payroll_run_id,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Releases every novelty attached to a payroll run back to pending
   * (recalculation or run cancellation). Accepts an optional transaction
   * client to participate in the caller's transaction.
   */
  async releaseFromRun(payroll_run_id: number, tx?: any): Promise<void> {
    const client = tx ?? this.prisma;

    await client.payroll_novelties.updateMany({
      where: { payroll_run_id, status: 'applied' },
      data: {
        status: 'pending',
        payroll_run_id: null,
        updated_at: new Date(),
      },
    });
  }
}
