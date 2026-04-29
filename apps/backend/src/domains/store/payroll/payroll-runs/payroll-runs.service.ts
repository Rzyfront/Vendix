import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { UpdatePayrollRunDto } from './dto/update-payroll-run.dto';
import { QueryPayrollRunDto } from './dto/query-payroll-run.dto';

const PAYROLL_RUN_INCLUDE = {
  store: {
    select: { id: true, name: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

const PAYROLL_RUN_DETAIL_INCLUDE = {
  ...PAYROLL_RUN_INCLUDE,
  payroll_items: {
    include: {
      employee: {
        select: {
          id: true,
          employee_code: true,
          first_name: true,
          last_name: true,
          document_type: true,
          document_number: true,
          position: true,
          department: true,
        },
      },
    },
  },
};

@Injectable()
export class PayrollRunsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Generate a unique payroll number for the organization.
   */
  private async generatePayrollNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `NOM-${year}`;

    const latest = await this.prisma.payroll_runs.findFirst({
      where: {
        payroll_number: { startsWith: prefix },
      },
      orderBy: { payroll_number: 'desc' },
      select: { payroll_number: true },
    });

    let sequence = 1;
    if (latest?.payroll_number) {
      const parts = latest.payroll_number.split('-');
      const last_seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last_seq)) {
        sequence = last_seq + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  async findAll(query: QueryPayrollRunDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      frequency,
      date_from,
      date_to,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.payroll_runsWhereInput = {
      ...(search && {
        payroll_number: { contains: search, mode: 'insensitive' as const },
      }),
      ...(status && { status: status as any }),
      ...(frequency && { frequency: frequency as any }),
      ...(date_from && {
        period_start: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.payroll_runs.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: PAYROLL_RUN_INCLUDE,
      }),
      this.prisma.payroll_runs.count({ where }),
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
    const run = await this.prisma.payroll_runs.findFirst({
      where: { id },
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    if (!run) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_002);
    }

    return run;
  }

  async create(dto: CreatePayrollRunDto) {
    const context = this.getContext();

    const payroll_number =
      dto.payroll_number || (await this.generatePayrollNumber());

    // Check for duplicate payroll number
    const existing = await this.prisma.payroll_runs.findFirst({
      where: { payroll_number },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
    }

    const run = await this.prisma.payroll_runs.create({
      data: {
        organization_id: context.organization_id,
        store_id: dto.store_id || context.store_id || null,
        payroll_number,
        status: 'draft',
        frequency: dto.frequency as any,
        period_start: new Date(dto.period_start),
        period_end: new Date(dto.period_end),
        payment_date: dto.payment_date ? new Date(dto.payment_date) : null,
        created_by_user_id: context.user_id,
      },
      include: PAYROLL_RUN_INCLUDE,
    });

    return run;
  }

  async update(id: number, dto: UpdatePayrollRunDto) {
    const run = await this.findOne(id);

    if (run.status !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Cannot edit payroll run in '${run.status}' state. Only draft runs can be edited.`,
      );
    }

    const update_data: any = {};

    if (dto.frequency) {
      update_data.frequency = dto.frequency;
    }
    if (dto.period_start) {
      update_data.period_start = new Date(dto.period_start);
    }
    if (dto.period_end) {
      update_data.period_end = new Date(dto.period_end);
    }
    if (dto.payroll_number) {
      // Check duplicate
      const existing = await this.prisma.payroll_runs.findFirst({
        where: {
          payroll_number: dto.payroll_number,
          id: { not: id },
        },
      });

      if (existing) {
        throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
      }
      update_data.payroll_number = dto.payroll_number;
    }

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: update_data,
      include: PAYROLL_RUN_INCLUDE,
    });

    return updated;
  }

  async remove(id: number) {
    const run = await this.findOne(id);

    if (run.status !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Cannot delete payroll run in '${run.status}' state. Only draft runs can be deleted.`,
      );
    }

    await this.prisma.payroll_runs.delete({
      where: { id },
    });
  }

  async getStats() {
    const [totals, by_status_raw, employee_count] = await Promise.all([
      this.prisma.payroll_runs.aggregate({
        where: { status: { in: ['approved', 'paid', 'sent', 'accepted'] } },
        _sum: {
          total_earnings: true,
          total_deductions: true,
          total_employer_costs: true,
          total_net_pay: true,
        },
        _count: { id: true },
      }),
      this.prisma.payroll_runs.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { total_net_pay: true },
      }),
      this.prisma.employees.count({
        where: { status: 'active' },
      }),
    ]);

    const by_status: Record<string, { count: number; total_net_pay: number }> =
      {};
    for (const row of by_status_raw) {
      if (row.status) {
        by_status[row.status] = {
          count: row._count.id,
          total_net_pay: Number(row._sum.total_net_pay || 0),
        };
      }
    }

    const total_net = Number(totals._sum.total_net_pay || 0);

    return {
      total_net_pay: total_net,
      active_employees: employee_count,
      total_employer_cost: Number(totals._sum.total_employer_costs || 0),
      avg_salary:
        employee_count > 0 ? Math.round(total_net / employee_count) : 0,
    };
  }
}
