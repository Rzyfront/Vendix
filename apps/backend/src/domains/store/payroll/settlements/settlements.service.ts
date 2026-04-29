import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { QuerySettlementDto } from './dto/query-settlement.dto';

const SETTLEMENT_INCLUDE = {
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
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

const SETTLEMENT_DETAIL_INCLUDE = {
  ...SETTLEMENT_INCLUDE,
  accounting_entry: true,
};

@Injectable()
export class SettlementsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findAll(query: QuerySettlementDto) {
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

    const where: Prisma.payroll_settlementsWhereInput = {
      ...(search && {
        OR: [
          {
            settlement_number: {
              contains: search,
              mode: 'insensitive' as const,
            },
          },
          {
            employee: {
              OR: [
                {
                  first_name: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  last_name: { contains: search, mode: 'insensitive' as const },
                },
              ],
            },
          },
        ],
      }),
      ...(status && { status: status as any }),
      ...(employee_id && { employee_id }),
    };

    const [data, total] = await Promise.all([
      this.prisma.payroll_settlements.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: SETTLEMENT_INCLUDE,
      }),
      this.prisma.payroll_settlements.count({ where }),
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
    const settlement = await this.prisma.payroll_settlements.findFirst({
      where: { id },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    if (!settlement) {
      throw new VendixHttpException(ErrorCodes.SETTLEMENT_FIND_001);
    }

    return settlement;
  }

  async getStats() {
    const [by_status_raw, totals] = await Promise.all([
      this.prisma.payroll_settlements.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { net_settlement: true },
      }),
      this.prisma.payroll_settlements.aggregate({
        where: { status: { in: ['calculated', 'approved', 'paid'] } },
        _sum: {
          gross_settlement: true,
          net_settlement: true,
          total_deductions: true,
        },
        _count: { id: true },
      }),
    ]);

    const by_status: Record<string, { count: number; total_net: number }> = {};
    for (const row of by_status_raw) {
      if (row.status) {
        by_status[row.status] = {
          count: row._count.id,
          total_net: Number(row._sum.net_settlement || 0),
        };
      }
    }

    return {
      by_status,
      total_gross: Number(totals._sum.gross_settlement || 0),
      total_net: Number(totals._sum.net_settlement || 0),
      total_deductions: Number(totals._sum.total_deductions || 0),
      total_count: totals._count.id,
    };
  }

  /**
   * Generate a unique settlement number: LIQ-{YEAR}-{PADDED_SEQ}
   */
  async generateSettlementNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `LIQ-${year}`;

    const latest = await this.prisma.payroll_settlements.findFirst({
      where: {
        settlement_number: { startsWith: prefix },
      },
      orderBy: { settlement_number: 'desc' },
      select: { settlement_number: true },
    });

    let sequence = 1;
    if (latest?.settlement_number) {
      const parts = latest.settlement_number.split('-');
      const last_seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last_seq)) {
        sequence = last_seq + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }
}
