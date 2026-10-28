import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

/**
 * Bloqueo por factura — con un documento de venta VIGENTE (`validated`,
 * `sent`, `accepted`, `rejected`) las líneas, precios, descuentos y envío de
 * la orden quedan congelados: la corrección es la nota crédito. Borradores
 * (sin número) y `cancelled`/`voided` no bloquean. Abonos, despacho y notas
 * no pasan por aquí.
 */
export async function assertOrderNotInvoiceLocked(
  prisma: Pick<StorePrismaService, 'invoices'>,
  orderId: number,
): Promise<void> {
  const invoice = await prisma.invoices.findFirst({
    where: {
      order_id: orderId,
      invoice_type: {
        in: ['sales_invoice', 'export_invoice', 'pos_equivalent_document'],
      },
      status: { in: ['validated', 'sent', 'accepted', 'rejected'] },
      financial_account_id: null,
    },
    select: { id: true, status: true },
    orderBy: { id: 'desc' },
  });
  if (invoice) {
    throw new VendixHttpException(
      ErrorCodes.ORD_INVOICED_LOCKED_001,
      undefined,
      { invoice_id: invoice.id, invoice_status: invoice.status },
    );
  }
}
