import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  GateDecision,
  enforceApproval,
  operationIsGoverned,
} from '../workflows/gates/approval-gate';

async function requesterName(
  prisma: StorePrismaService,
): Promise<string | null> {
  const userId = RequestContextService.getUserId();
  if (!userId) return null;
  const u = await prisma.users.findFirst({
    where: { id: userId },
    select: { first_name: true, last_name: true },
  });
  return u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : null;
}

/**
 * Flujos P1.3: a credit note a flow governs is not created until its request
 * is approved (operation `credit_note.create`, amount = the note: Σ quantity ×
 * unit price of its lines, or the whole invoice for a total note). The
 * approved request then runs once, as the requester, with the same DTO.
 */
export async function enforceCreditNoteApproval(
  prisma: StorePrismaService,
  dto: {
    related_invoice_id: number;
    reason?: string;
    items?: Array<{ quantity: number; unit_price: number }>;
  },
): Promise<GateDecision> {
  if (!(await operationIsGoverned(prisma, 'credit_note.create')))
    return { status: 'free' };
  const invoice = await prisma.invoices.findFirst({
    where: { id: dto.related_invoice_id },
    select: { id: true, invoice_number: true, total_amount: true },
  });
  if (!invoice) return { status: 'free' }; // the service answers its own 404
  const amount =
    dto.items && dto.items.length > 0
      ? dto.items.reduce(
          (sum, i) => sum + Number(i.quantity) * Number(i.unit_price),
          0,
        )
      : Number(invoice.total_amount);
  return enforceApproval(prisma, {
    operation: 'credit_note.create',
    entity_type: 'invoice',
    entity_id: invoice.id,
    amount,
    context: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      total_amount: amount,
      reason: dto.reason ?? null,
      requested_by: await requesterName(prisma),
    },
    request: { method: 'createCreditNote', args: [dto] },
  });
}

/**
 * Flujos P1.3: voiding an invoice a flow governs waits for its request
 * (operation `invoice.void`, amount = invoice total); the approved request
 * then voids it once, as the requester.
 */
export async function enforceInvoiceVoidApproval(
  prisma: StorePrismaService,
  invoiceId: number,
): Promise<GateDecision> {
  if (!(await operationIsGoverned(prisma, 'invoice.void')))
    return { status: 'free' };
  const invoice = await prisma.invoices.findFirst({
    where: { id: invoiceId },
    select: {
      id: true,
      invoice_number: true,
      total_amount: true,
      invoice_type: true,
    },
  });
  // Notes are voided through their own balance rules; only sales invoices here.
  if (
    !invoice ||
    invoice.invoice_type === 'credit_note' ||
    invoice.invoice_type === 'debit_note'
  ) {
    return { status: 'free' };
  }
  return enforceApproval(prisma, {
    operation: 'invoice.void',
    entity_type: 'invoice',
    entity_id: invoice.id,
    amount: Number(invoice.total_amount),
    context: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      total_amount: invoice.total_amount,
      requested_by: await requesterName(prisma),
    },
    request: { method: 'void', args: [invoice.id] },
  });
}
