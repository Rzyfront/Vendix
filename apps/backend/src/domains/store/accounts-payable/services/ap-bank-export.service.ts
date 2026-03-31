import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class ApBankExportService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Generate a batch export file for scheduled/pending AP payments.
   * Returns CSV format compatible with most Colombian banks.
   * Future: refactor to bank-specific adapters (Bancolombia, Davivienda, etc.)
   */
  async generateBatchExport(params: {
    supplier_ids?: number[];
    date_from?: string;
    date_to?: string;
  }): Promise<{ filename: string; content: string; count: number }> {
    // 1. Query AP records that are open/partial/overdue
    const where: any = { status: { in: ['open', 'partial', 'overdue'] } };

    if (params.supplier_ids?.length) {
      where.supplier_id = { in: params.supplier_ids };
    }

    if (params.date_from || params.date_to) {
      where.due_date = {};
      if (params.date_from) where.due_date.gte = new Date(params.date_from);
      if (params.date_to) where.due_date.lte = new Date(params.date_to);
    }

    const records = await this.prisma.accounts_payable.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            tax_id: true,
            bank_name: true,
            bank_account_number: true,
            bank_account_type: true,
          },
        },
      },
      orderBy: { due_date: 'asc' },
    });

    // 2. Generate CSV
    const header =
      'supplier_name,tax_id,bank_name,account_number,account_type,amount,currency,due_date,document_number,reference';

    const rows = records.map((r) =>
      [
        r.supplier?.name || '',
        r.supplier?.tax_id || '',
        r.supplier?.bank_name || '',
        r.supplier?.bank_account_number || '',
        r.supplier?.bank_account_type || '',
        Number(r.balance).toFixed(2),
        r.currency,
        r.due_date.toISOString().split('T')[0],
        r.document_number || '',
        `AP-${r.id}`,
      ].join(','),
    );

    const content = [header, ...rows].join('\n');
    const filename = `ap_batch_export_${new Date().toISOString().split('T')[0]}.csv`;

    return { filename, content, count: records.length };
  }
}
