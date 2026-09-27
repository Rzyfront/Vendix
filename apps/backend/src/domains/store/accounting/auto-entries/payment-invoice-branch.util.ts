/**
 * Criterio ÚNICO de la rama «con factura» de `payment.received`.
 *
 * Extraído tal cual de `AutoEntryService.onPaymentReceived`: la orden cuenta
 * como facturada si tiene una factura no anulada/cancelada, o si su venta ya
 * la reconoció `credit_sale.created` (asiento posted con `source_id = order`).
 * En esa rama el asiento del cobro sólo cruza cartera (DR caja / CR 1305) e
 * IGNORA `withholding_breakdown`.
 *
 * Lo reutiliza `OrderFlowService.emitLegPaymentReceivedEvents` (PR #858) para
 * no persistir ni emitir retención en un cobro que caerá en esa rama: la fila
 * quedaría sin asiento que la respalde y el certificado la contaría dos veces.
 *
 * Mismo orden y misma forma de consultas que el original, para que ambos
 * carriles decidan igual.
 */
export interface PaymentInvoiceBranchDb {
  invoices: { findFirst: (args: any) => Promise<any> };
  withoutScope: () => {
    accounting_entries: { findFirst: (args: any) => Promise<any> };
  };
}

export interface PaymentInvoiceBranch {
  /** Hay factura no anulada/cancelada de la orden. */
  has_real_invoice: boolean;
  /** `credit_sale.created` ya reconoció la venta. */
  has_credit_sale: boolean;
  /** Rama «con factura» de `onPaymentReceived`. */
  has_invoice: boolean;
}

export async function resolvePaymentInvoiceBranch(
  db: PaymentInvoiceBranchDb,
  params: { order_id?: number | null; organization_id: number },
): Promise<PaymentInvoiceBranch> {
  if (!params.order_id) {
    return { has_real_invoice: false, has_credit_sale: false, has_invoice: false };
  }
  const invoice = await db.invoices.findFirst({
    where: {
      order_id: params.order_id,
      status: { notIn: ['cancelled', 'voided'] },
    },
    select: { id: true },
  });
  const has_real_invoice = !!invoice;
  // Venta a crédito: `credit_sale.created` ya reconoció el ingreso +
  // impuestos contra 1305 (con propina incluida en la 1305 y acreditada a su
  // pasivo). El cobro posterior sólo cruza cartera (DR caja / CR 1305); por
  // la rama «sin factura» reconocería la venta otra vez, y con factura no
  // debe volver a separar la propina.
  const credit_sale = await db.withoutScope().accounting_entries.findFirst({
    where: {
      organization_id: params.organization_id,
      source_type: 'credit_sale.created',
      source_id: params.order_id,
      status: 'posted',
    },
    select: { id: true },
  });
  const has_credit_sale = !!credit_sale;
  return {
    has_real_invoice,
    has_credit_sale,
    has_invoice: has_real_invoice || has_credit_sale,
  };
}
