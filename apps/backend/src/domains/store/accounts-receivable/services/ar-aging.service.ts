import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class ArAgingService {
  private readonly logger = new Logger(ArAgingService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // ─── AGING REPORT ──────────────────────────────────────────
  async getAgingReport() {
    const now = new Date();

    const all = await this.prisma.accounts_receivable.findMany({
      where: { status: { in: ['open', 'partial', 'overdue'] } },
      select: {
        id: true,
        balance: true,
        due_date: true,
        customer_id: true,
        customer: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    const buckets = {
      current: 0,
      days_1_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      days_91_120: 0,
      days_120_plus: 0,
    };

    const customer_breakdown: Record<
      number,
      { customer_id: number; customer_name: string; total: number }
    > = {};

    for (const ar of all) {
      const days_overdue = Math.floor(
        (now.getTime() - new Date(ar.due_date).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const amount = Number(ar.balance);

      if (days_overdue <= 0) {
        buckets.current += amount;
      } else if (days_overdue <= 30) {
        buckets.days_1_30 += amount;
      } else if (days_overdue <= 60) {
        buckets.days_31_60 += amount;
      } else if (days_overdue <= 90) {
        buckets.days_61_90 += amount;
      } else if (days_overdue <= 120) {
        buckets.days_91_120 += amount;
      } else {
        buckets.days_120_plus += amount;
      }

      // Accumulate per customer
      if (!customer_breakdown[ar.customer_id]) {
        customer_breakdown[ar.customer_id] = {
          customer_id: ar.customer_id,
          customer_name:
            `${ar.customer?.first_name || ''} ${ar.customer?.last_name || ''}`.trim() ||
            'N/A',
          total: 0,
        };
      }
      customer_breakdown[ar.customer_id].total += amount;
    }

    const total = Object.values(buckets).reduce((sum, val) => sum + val, 0);

    return {
      buckets,
      total,
      record_count: all.length,
      top_customers: Object.values(customer_breakdown)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    };
  }

  // ─── UPDATE OVERDUE STATUS ─────────────────────────────────
  async updateOverdueStatus() {
    const now = new Date();

    // Find all open/partial ARs that are past due
    const overdue_records = await this.prisma.accounts_receivable.findMany({
      where: {
        status: { in: ['open', 'partial'] },
        due_date: { lt: now },
      },
      select: { id: true, due_date: true },
    });

    let updated_count = 0;

    for (const ar of overdue_records) {
      const days_overdue = Math.floor(
        (now.getTime() - new Date(ar.due_date).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await this.prisma.accounts_receivable.update({
        where: { id: ar.id },
        data: {
          status: 'overdue',
          days_overdue,
        },
      });

      updated_count++;
    }

    this.logger.log(
      `Updated overdue status for ${updated_count} accounts receivable records`,
    );

    return { updated_count };
  }
}
