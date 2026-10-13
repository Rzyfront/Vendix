import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PLATFORM_TIMEZONE } from '../../../../common/constants/platform-fiscal.constants';
import { localDateString } from '../../../../common/utils/store-timezone.util';
import {
  PlatformInvoicePaymentMethod,
  RegisterPlatformInvoicePaymentDto,
} from './dto/subscription-fiscal.dto';

export const PLATFORM_INVOICE_PAYMENT_KIND = 'platform_invoice_payment';
export const PLATFORM_INVOICE_PAYMENT_EVENT = 'platform_invoice.payment_received';

export type PlatformInvoiceState = 'accepted' | 'rejected' | 'pending' | 'error';
export type PlatformCollectionStatus = 'paid' | 'partial' | 'pending' | 'overdue';

export interface PlatformInvoicePayment {
  id: number;
  amount: string;
  paid_at: string;
  payment_method: PlatformInvoicePaymentMethod;
  reference: string | null;
  notes: string | null;
  journal_entry_id: number | null;
  created_at: string;
}

export interface PlatformInvoicePaymentReceivedEvent {
  organization_id: number;
  accounting_entity_id: number;
  evidence_id: number;
  transmission_id: number;
  document_number: string;
  amount: number;
  payment_method: PlatformInvoicePaymentMethod;
  paid_at: string;
  reference?: string | null;
  user_id?: number | null;
}

/** Importe monetario a centavos enteros (nunca se comparan floats). */
export function toCents(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Estado DIAN derivado de la transmisión; lo desconocido es 'pending'. */
export function derivePlatformInvoiceState(
  dianStatus?: string | null,
  transmissionStatus?: string | null,
): PlatformInvoiceState {
  const values = [dianStatus, transmissionStatus];
  if (values.includes('accepted')) return 'accepted';
  if (values.includes('rejected')) return 'rejected';
  if (values.includes('error')) return 'error';
  return 'pending';
}

/**
 * Estado de cobranza. `null` si la factura no está aceptada. Fechas date-only
 * (YYYY-MM-DD) comparadas como texto, sin instantes.
 */
export function computeCollectionStatus(args: {
  state: PlatformInvoiceState;
  totalCents: number;
  paidCents: number;
  dueDate: string | null;
  today: string;
}): PlatformCollectionStatus | null {
  if (args.state !== 'accepted') return null;
  const balance = Math.max(0, args.totalCents - args.paidCents);
  if (balance === 0) return 'paid';
  if (args.dueDate && args.today > args.dueDate) return 'overdue';
  return args.paidCents > 0 ? 'partial' : 'pending';
}

export function platformToday(): string {
  return localDateString(new Date(), PLATFORM_TIMEZONE);
}

export function normalizeDueDate(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateString(value, PLATFORM_TIMEZONE);
  }
  return null;
}

@Injectable()
export class PlatformInvoicePaymentsService {
  private readonly logger = new Logger(PlatformInvoicePaymentsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private mapPayment(row: any): PlatformInvoicePayment {
    const m = (row.metadata ?? {}) as Record<string, any>;
    return {
      id: row.id,
      amount: centsToString(toCents(m.amount)),
      paid_at: String(m.paid_at ?? ''),
      payment_method: m.payment_method,
      reference: m.reference ?? null,
      notes: m.notes ?? null,
      journal_entry_id: m.journal_entry_id ?? null,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at ?? ''),
    };
  }

  private async readPayments(
    client: any,
    transmissionId: number,
  ): Promise<PlatformInvoicePayment[]> {
    const rows = await client.fiscal_evidences.findMany({
      where: {
        fiscal_transmission_id: transmissionId,
        evidence_type: 'payment_receipt',
      },
      orderBy: { id: 'desc' },
    });
    return (rows as any[])
      .filter((r) => r?.metadata?.kind === PLATFORM_INVOICE_PAYMENT_KIND)
      .map((r) => this.mapPayment(r));
  }

  /** Pagos registrados, el más reciente primero. */
  async listPayments(transmissionId: number): Promise<PlatformInvoicePayment[]> {
    return this.readPayments(this.prisma.withoutScope(), transmissionId);
  }

  /**
   * Cartera de una factura: amount_paid / balance_due / collection_status /
   * payments. Los importes se suman en centavos.
   */
  async summarize(args: {
    transmissionId: number;
    total: unknown;
    dueDate: string | null;
    state: PlatformInvoiceState;
  }): Promise<{
    amount_paid: string;
    balance_due: string;
    collection_status: PlatformCollectionStatus | null;
    payments: PlatformInvoicePayment[];
  }> {
    const payments = await this.listPayments(args.transmissionId);
    return this.buildSummary(payments, args);
  }

  /**
   * Cartera en lote para el listado: una sola consulta de evidencias para
   * todas las transmisiones. Las que no son `platform_invoice` no tienen cartera.
   */
  async collectionForTransmissions(
    rows: Array<{
      id: number;
      source_type?: string | null;
      dian_status?: string | null;
      transmission_status?: string | null;
    }>,
  ): Promise<
    Map<
      number,
      {
        total: string;
        amount_paid: string;
        balance_due: string;
        due_date: string | null;
        collection_status: PlatformCollectionStatus | null;
      }
    >
  > {
    const result = new Map<number, any>();
    const invoices = rows.filter((r) => r.source_type === 'platform_invoice');
    if (invoices.length === 0) return result;

    const evidences = await this.prisma.withoutScope().fiscal_evidences.findMany({
      where: {
        fiscal_transmission_id: { in: invoices.map((r) => r.id) },
        evidence_type: { in: ['manual_support', 'payment_receipt'] },
      },
      orderBy: { id: 'asc' },
      select: {
        fiscal_transmission_id: true,
        evidence_type: true,
        metadata: true,
      },
    });

    const snapshots = new Map<number, Record<string, any>>();
    const paid = new Map<number, number>();
    for (const e of evidences as any[]) {
      const tid = e.fiscal_transmission_id as number;
      const m = (e.metadata ?? {}) as Record<string, any>;
      if (e.evidence_type === 'manual_support') {
        // El más reciente gana (orden asc → se sobrescribe).
        if (m.kind === 'platform_invoice_snapshot') snapshots.set(tid, m);
      } else if (m.kind === PLATFORM_INVOICE_PAYMENT_KIND) {
        paid.set(tid, (paid.get(tid) ?? 0) + toCents(m.amount));
      }
    }

    const today = platformToday();
    for (const r of invoices) {
      const snap = snapshots.get(r.id);
      const totalCents = toCents(snap?.totals?.total ?? 0);
      const paidCents = paid.get(r.id) ?? 0;
      const dueDate = normalizeDueDate(snap?.due_date);
      const state = derivePlatformInvoiceState(r.dian_status, r.transmission_status);
      result.set(r.id, {
        total: centsToString(totalCents),
        amount_paid: centsToString(paidCents),
        balance_due: centsToString(Math.max(0, totalCents - paidCents)),
        due_date: dueDate,
        collection_status: computeCollectionStatus({
          state,
          totalCents,
          paidCents,
          dueDate,
          today,
        }),
      });
    }
    return result;
  }

  private buildSummary(
    payments: PlatformInvoicePayment[],
    args: { total: unknown; dueDate: string | null; state: PlatformInvoiceState },
  ) {
    const totalCents = toCents(args.total);
    const paidCents = payments.reduce((acc, p) => acc + toCents(p.amount), 0);
    return {
      amount_paid: centsToString(paidCents),
      balance_due: centsToString(Math.max(0, totalCents - paidCents)),
      collection_status: computeCollectionStatus({
        state: args.state,
        totalCents,
        paidCents,
        dueDate: args.dueDate,
        today: platformToday(),
      }),
      payments,
    };
  }

  /**
   * Registra un cobro. La evidencia se crea en una transacción con la fila de
   * la transmisión bloqueada (dos cobros simultáneos no pueden exceder el
   * saldo); el evento contable sale DESPUÉS del commit.
   */
  async registerPayment(
    transmissionId: number,
    dto: RegisterPlatformInvoicePaymentDto,
    userId: number | null,
  ): Promise<PlatformInvoicePayment> {
    this.assertCivilDate(dto.paid_at);
    const amountCents = toCents(dto.amount);
    if (amountCents <= 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El monto del pago debe ser mayor que cero.',
      );
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM fiscal_transmissions WHERE id = ${transmissionId} FOR UPDATE`;

      const transmission = await tx.fiscal_transmissions.findFirst({
        where: { id: transmissionId, source_type: 'platform_invoice' },
        select: {
          id: true,
          organization_id: true,
          accounting_entity_id: true,
          document_number: true,
          dian_status: true,
          transmission_status: true,
        },
      });
      if (!transmission) {
        throw new VendixHttpException(
          ErrorCodes.SYS_NOT_FOUND_001,
          'Factura de plataforma no encontrada.',
        );
      }
      const state = derivePlatformInvoiceState(
        transmission.dian_status,
        transmission.transmission_status,
      );
      if (state !== 'accepted') {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Solo se pueden registrar pagos sobre facturas aceptadas por la DIAN.',
        );
      }

      const snapshot = await tx.fiscal_evidences.findFirst({
        where: {
          fiscal_transmission_id: transmission.id,
          evidence_type: 'manual_support',
        },
        orderBy: { created_at: 'desc' },
        select: { metadata: true },
      });
      const totalCents = toCents(
        (snapshot?.metadata as any)?.totals?.total ?? 0,
      );
      const payments = await this.readPayments(tx, transmission.id);
      const paidCents = payments.reduce((acc, p) => acc + toCents(p.amount), 0);
      const balanceCents = Math.max(0, totalCents - paidCents);
      if (amountCents > balanceCents) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `El pago (${centsToString(amountCents)}) supera el saldo pendiente (${centsToString(balanceCents)}).`,
        );
      }

      const evidence = await tx.fiscal_evidences.create({
        data: {
          organization_id: transmission.organization_id,
          store_id: null,
          accounting_entity_id: transmission.accounting_entity_id,
          fiscal_transmission_id: transmission.id,
          evidence_type: 'payment_receipt',
          storage_key: null,
          content_hash: null,
          created_by_user_id: userId,
          metadata: {
            kind: PLATFORM_INVOICE_PAYMENT_KIND,
            amount: Number(centsToString(amountCents)),
            paid_at: dto.paid_at,
            payment_method: dto.payment_method,
            reference: dto.reference ?? null,
            notes: dto.notes ?? null,
            journal_entry_id: null,
            registered_by_user_id: userId,
          },
        },
      });
      return { evidence, transmission };
    });

    const { evidence, transmission } = created;

    const event: PlatformInvoicePaymentReceivedEvent = {
      organization_id: transmission.organization_id,
      accounting_entity_id: transmission.accounting_entity_id,
      evidence_id: evidence.id,
      transmission_id: transmission.id,
      document_number: transmission.document_number,
      amount: Number(centsToString(amountCents)),
      payment_method: dto.payment_method,
      paid_at: dto.paid_at,
      reference: dto.reference ?? null,
      user_id: userId,
    };
    try {
      await this.eventEmitter.emitAsync(PLATFORM_INVOICE_PAYMENT_EVENT, event);
    } catch (error: any) {
      this.logger.error(
        `${PLATFORM_INVOICE_PAYMENT_EVENT} failed for evidence #${evidence.id}: ${error?.message ?? error}`,
        error?.stack,
      );
    }

    const entry = await this.waitForAutoEntry(
      transmission.organization_id,
      PLATFORM_INVOICE_PAYMENT_EVENT,
      evidence.id,
    );

    let journalEntryId: number | null = null;
    if (entry) {
      journalEntryId = entry.id;
      await this.prisma.withoutScope().fiscal_evidences.update({
        where: { id: evidence.id },
        data: {
          metadata: { ...(evidence.metadata as object), journal_entry_id: entry.id },
        },
      });
    } else {
      this.logger.warn(
        `Platform invoice payment evidence #${evidence.id} registered but no accounting entry found for ${PLATFORM_INVOICE_PAYMENT_EVENT}; listener may have skipped (fiscal gate disabled or mapping missing).`,
      );
    }

    return this.mapPayment({
      ...evidence,
      metadata: { ...(evidence.metadata as object), journal_entry_id: journalEntryId },
    });
  }

  private assertCivilDate(value: string): void {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    const valid =
      !!m &&
      !!d &&
      d.getUTCFullYear() === +m[1] &&
      d.getUTCMonth() === +m[2] - 1 &&
      d.getUTCDate() === +m[3];
    if (!valid) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'paid_at no es una fecha válida (YYYY-MM-DD).',
      );
    }
  }

  private async waitForAutoEntry(
    organization_id: number,
    source_type: string,
    source_id: number,
  ): Promise<{ id: number } | null> {
    const maxAttempts = 4;
    const delayMs = 250;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const entry = await this.prisma.withoutScope().accounting_entries.findFirst({
        where: { organization_id, source_type, source_id },
        select: { id: true },
        orderBy: { id: 'desc' },
      });
      if (entry) return entry;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }
}
