import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class ArCollectionService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ─── UPCOMING DUE ──────────────────────────────────────────
  async getUpcomingDue(days: number = 7) {
    const now = new Date();
    const future_date = new Date(
      now.getTime() + days * 24 * 60 * 60 * 1000,
    );

    return this.prisma.accounts_receivable.findMany({
      where: {
        status: { in: ['open', 'partial'] },
        due_date: { gte: now, lte: future_date },
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { due_date: 'asc' },
    });
  }

  // ─── OVERDUE BY CUSTOMER ───────────────────────────────────
  async getOverdueByCustomer() {
    const overdue = await this.prisma.accounts_receivable.findMany({
      where: { status: 'overdue' },
      select: {
        id: true,
        balance: true,
        due_date: true,
        days_overdue: true,
        document_number: true,
        customer_id: true,
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { days_overdue: 'desc' },
    });

    // Group by customer
    const grouped: Record<
      number,
      {
        customer: { id: number; name: string; email: string; phone: string };
        total_overdue: number;
        max_days_overdue: number;
        records: typeof overdue;
      }
    > = {};

    for (const ar of overdue) {
      if (!grouped[ar.customer_id]) {
        grouped[ar.customer_id] = {
          customer: ar.customer as any,
          total_overdue: 0,
          max_days_overdue: 0,
          records: [],
        };
      }

      grouped[ar.customer_id].total_overdue += Number(ar.balance);
      grouped[ar.customer_id].max_days_overdue = Math.max(
        grouped[ar.customer_id].max_days_overdue,
        ar.days_overdue || 0,
      );
      grouped[ar.customer_id].records.push(ar);
    }

    return Object.values(grouped).sort(
      (a, b) => b.total_overdue - a.total_overdue,
    );
  }
}
