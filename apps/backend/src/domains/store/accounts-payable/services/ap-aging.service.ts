import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class ApAgingService {
  private readonly logger = new Logger(ApAgingService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // ─── AGING REPORT ──────────────────────────────────────────
  async getAgingReport() {
    const now = new Date();

    const all = await this.prisma.accounts_payable.findMany({
      where: { status: { in: ['open', 'partial', 'overdue'] } },
      select: {
        id: true,
        balance: true,
        due_date: true,
        supplier_id: true,
        supplier: { select: { id: true, name: true } },
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

    const supplier_breakdown: Record<
      number,
      { supplier_id: number; supplier_name: string; total: number }
    > = {};

    for (const ap of all) {
      const days_overdue = Math.floor(
        (now.getTime() - new Date(ap.due_date).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const amount = Number(ap.balance);

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

      // Accumulate per supplier
      if (!supplier_breakdown[ap.supplier_id]) {
        supplier_breakdown[ap.supplier_id] = {
          supplier_id: ap.supplier_id,
          supplier_name: ap.supplier?.name || 'N/A',
          total: 0,
        };
      }
      supplier_breakdown[ap.supplier_id].total += amount;
    }

    const total = Object.values(buckets).reduce((sum, val) => sum + val, 0);

    return {
      buckets,
      total,
      record_count: all.length,
      top_suppliers: Object.values(supplier_breakdown)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    };
  }

  // ─── UPDATE OVERDUE STATUS ─────────────────────────────────
  async updateOverdueStatus() {
    const now = new Date();

    // Find all open/partial APs that are past due
    const overdue_records = await this.prisma.accounts_payable.findMany({
      where: {
        status: { in: ['open', 'partial'] },
        due_date: { lt: now },
      },
      select: { id: true, due_date: true },
    });

    let updated_count = 0;

    for (const ap of overdue_records) {
      const days_overdue = Math.floor(
        (now.getTime() - new Date(ap.due_date).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await this.prisma.accounts_payable.update({
        where: { id: ap.id },
        data: {
          status: 'overdue',
          days_overdue,
        },
      });

      updated_count++;
    }

    this.logger.log(
      `Updated overdue status for ${updated_count} accounts payable records`,
    );

    return { updated_count };
  }
}
