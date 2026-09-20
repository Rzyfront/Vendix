import { Prisma } from '@prisma/client';

export interface ProjectedInvoiceLine {
  data: {
    financial_source_line_id: number;
    description: string;
    quantity: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    discount_amount: Prisma.Decimal;
    tax_amount: Prisma.Decimal;
    total_amount: Prisma.Decimal;
  };
  taxes: Array<{
    tax_rate_id: number | null;
    tax_name: string;
    tax_rate: Prisma.Decimal | number;
    taxable_amount: Prisma.Decimal;
    tax_amount: Prisma.Decimal;
    tax_type: any;
    is_inclusive: boolean;
  }>;
}

export interface ProjectedAccountInvoice {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  items: ProjectedInvoiceLine[];
}

/**
 * Projects an independent financial account into invoice lines and taxes.
 * Each account line represents an immutable financial participation in the
 * source order's items/charges.
 */
export function projectFinancialAccountInvoice(
  account: {
    id: number;
    label?: string | null;
    subtotal_amount: Prisma.Decimal;
    discount_amount: Prisma.Decimal;
    tax_amount: Prisma.Decimal;
    grand_total: Prisma.Decimal;
    lines?: Array<{
      id: number;
      description?: string | null;
      subtotal_amount: Prisma.Decimal;
      discount_amount: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      total_amount: Prisma.Decimal;
      taxes?: Array<{
        tax_rate_id?: number | null;
        tax_name: string;
        tax_rate: Prisma.Decimal | number;
        tax_amount: Prisma.Decimal;
        tax_type?: any;
        is_inclusive?: boolean | null;
      }>;
    }>;
  },
  orderNumber: string | number,
): ProjectedAccountInvoice {
  const items: ProjectedInvoiceLine[] = (account.lines ?? []).map((line) => ({
    data: {
      financial_source_line_id: line.id,
      description: line.description || `Cuenta ${account.label ?? ''} - Orden #${orderNumber}`,
      quantity: new Prisma.Decimal(1),
      unit_price: line.subtotal_amount,
      discount_amount: line.discount_amount ?? new Prisma.Decimal(0),
      tax_amount: line.tax_amount ?? new Prisma.Decimal(0),
      total_amount: line.total_amount,
    },
    taxes: (line.taxes ?? []).map((tax) => ({
      tax_rate_id: tax.tax_rate_id ?? null,
      tax_name: tax.tax_name,
      tax_rate: tax.tax_rate,
      taxable_amount: line.subtotal_amount,
      tax_amount: tax.tax_amount,
      tax_type: tax.tax_type ?? null,
      is_inclusive: tax.is_inclusive ?? false,
    })),
  }));

  return {
    subtotal: account.subtotal_amount,
    discount: account.discount_amount,
    tax: account.tax_amount,
    total: account.grand_total,
    items,
  };
}
