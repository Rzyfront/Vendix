/**
 * PlatformCreditNotesService — notas crédito/débito del riel plataforma.
 *
 * Las facturas de plataforma NO viven en `invoices`: viven en
 * `fiscal_transmissions` (source_type `platform_invoice` o
 * `subscription_invoice`, document_type `sales_invoice`). Por eso este servicio
 * ya no pasa por el `InvoicingService` de tienda (que exige `store_id` y rechaza
 * las notas): resuelve el original en `fiscal_transmissions`, deriva las líneas
 * de la factura corregida y delega la numeración, la firma y la transmisión en
 * `SubscriptionFiscalService.issuePlatformNote`.
 *
 * - Nota crédito sin `items` = nota TOTAL: copia todas las líneas del original.
 * - Nota crédito con `items`: parcial; hereda el impuesto del original.
 * - Nota débito: exige `items`; no tiene tope de saldo.
 * - Saldo acreditable = total del original − notas crédito no rechazadas.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AuditService } from '@common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';

import {
  dianLineExtension,
  dianSum,
} from '../../../../common/money-kernel/dian-money';
import { isDianUnitCode } from '../../../store/invoicing/providers/dian-direct/constants/dian-unit-codes';
import {
  PlatformCreateCreditNoteDto,
  PlatformCreateDebitNoteDto,
} from './dto/platform-credit-note.dto';
import { PlatformDeliveryService } from './platform-delivery.service';
import {
  NOTE_CORRECTABLE_SOURCES,
  NOTE_TYPE_LABEL,
  PlatformNoteComputation,
  PlatformNoteOriginal,
  PlatformNoteResult,
  PlatformNoteType,
  creditBalance,
  linePercent,
  noteTaxSignature,
  totalNoteComputation,
} from './platform-note.helpers';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

export const PLATFORM_NOTE_DEFAULT_UNIT_CODE = 'NIU';

/**
 * Normaliza y valida las líneas de una nota (función pura):
 *  - `unit_code` por línea: el de la línea, o el de la línea original, o 'NIU'.
 *    Debe pertenecer al catálogo DIAN (`isDianUnitCode`); 'MON' no existe (el mes es 'LUN').
 *  - importes con el kernel DIAN (`dianLineExtension`/`dianSum`), sin Math.round.
 *  - si `balance` viene, la suma de las líneas no puede superarlo.
 */
export function buildPlatformNoteLines(
  items: Array<{
    description: string;
    quantity: number | string;
    unit_price?: number | string;
    unit_code?: string;
  }>,
  opts: { balance?: number | string; fallback_unit_code?: string } = {},
): {
  lines: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    unit_code: string;
    line_extension: string;
  }>;
  total: string;
} {
  const lines = items.map((line) => {
    const unit_code =
      line.unit_code ??
      opts.fallback_unit_code ??
      PLATFORM_NOTE_DEFAULT_UNIT_CODE;
    if (!isDianUnitCode(unit_code)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        `unit_code «${unit_code}» no es una unidad de medida DIAN válida (el mes es «LUN», no «MON»).`,
        { unit_code },
      );
    }
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'La cantidad de cada línea debe ser mayor que 0.',
        { quantity: line.quantity },
      );
    }
    const unit_price = Number(line.unit_price);
    if (!Number.isFinite(unit_price) || unit_price <= 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'El precio unitario de cada línea debe ser mayor que 0.',
        { unit_price: line.unit_price },
      );
    }
    return {
      description: line.description,
      quantity,
      unit_price,
      unit_code,
      line_extension: dianLineExtension({ quantity, unit_price }),
    };
  });
  const total = dianSum(lines.map((l) => l.line_extension));
  if (opts.balance !== undefined && Number(total) > Number(opts.balance)) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_VALIDATE_001,
      `El valor de la nota (${total}) supera el saldo de la factura original (${Number(opts.balance)}).`,
      { total, balance: Number(opts.balance) },
    );
  }
  return { lines, total };
}

export interface PlatformNotesOverview {
  invoice: {
    id: number;
    document_number: string;
    cufe: string | null;
    dian_status: string;
    issue_date: string | null;
    total: string;
    customer_name: string | null;
  };
  credit_balance: string;
  can_create_notes: boolean;
  blocked_reason: string | null;
  lines: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    unit_code: string;
    tax_rate: number;
  }>;
  notes: unknown[];
}

type NoteDto = PlatformCreateCreditNoteDto | PlatformCreateDebitNoteDto;

@Injectable()
export class PlatformCreditNotesService {
  private readonly logger = new Logger(PlatformCreditNotesService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
    private readonly fiscal: SubscriptionFiscalService,
    private readonly audit: AuditService,
    private readonly delivery: PlatformDeliveryService,
  ) {}

  async createCreditNote(
    dto: PlatformCreateCreditNoteDto,
    actorUserId: number,
  ): Promise<PlatformNoteResult> {
    return this.createNote(dto, 'credit_note', actorUserId);
  }

  async createDebitNote(
    dto: PlatformCreateDebitNoteDto,
    actorUserId: number,
  ): Promise<PlatformNoteResult> {
    return this.createNote(dto, 'debit_note', actorUserId);
  }

  /** Why an original cannot be corrected, or null when it can. */
  private blockedReason(
    t: { document_type: string; source_type: string; dian_status: string; cufe: string | null; document_number: string },
    type: PlatformNoteType | null,
  ): { code: keyof typeof ErrorCodes; message: string } | null {
    const label = type ? NOTE_TYPE_LABEL[type] : 'notas crédito o débito';
    if (t.document_type !== 'sales_invoice') {
      return {
        code: 'FISCAL_DOCUMENT_UNSUPPORTED',
        message: `El documento ${t.document_number} es de tipo «${t.document_type}» y no admite ${label}: solo se corrigen facturas de venta.`,
      };
    }
    if (!(NOTE_CORRECTABLE_SOURCES as readonly string[]).includes(t.source_type)) {
      return {
        code: 'FISCAL_DOCUMENT_UNSUPPORTED',
        message: `El documento ${t.document_number} no admite ${label}.`,
      };
    }
    if (t.dian_status !== 'accepted' || !t.cufe) {
      return {
        code: 'INVOICING_STATUS_002',
        message: `La factura ${t.document_number} debe estar aceptada por la DIAN (estado: ${t.dian_status}) antes de emitir ${label}.`,
      };
    }
    return null;
  }

  private async loadOriginalTransmission(id: number) {
    const ctx = await this.platformOrg.requirePlatformContext();
    const row = await this.prisma.withoutScope().fiscal_transmissions.findFirst({
      where: {
        id,
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
      },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontró la factura ${id} en la plataforma.`,
        { related_invoice_id: id },
      );
    }
    return { row, ctx };
  }

  private async createNote(
    dto: NoteDto,
    type: PlatformNoteType,
    actorUserId: number,
  ): Promise<PlatformNoteResult> {
    const { row, ctx } = await this.loadOriginalTransmission(
      dto.related_invoice_id,
    );
    const blocked = this.blockedReason(row as any, type);
    if (blocked) {
      throw new VendixHttpException(ErrorCodes[blocked.code], blocked.message, {
        related_invoice_id: row.id,
        dian_status: row.dian_status,
      });
    }

    const original = await this.fiscal.loadPlatformNoteOriginal(row as any);
    const items = dto.items ?? [];
    const isTotal = type === 'credit_note' && items.length === 0;

    if (type === 'debit_note' && items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'La nota débito requiere al menos una línea con el valor a cobrar.',
      );
    }

    const credited =
      type === 'credit_note'
        ? await this.fiscal.sumCreditedNotes(row.id)
        : [];
    const balance = creditBalance(original.total, credited);

    const computation = isTotal
      ? totalNoteComputation(original)
      : this.partialComputation(original, items);

    if (type === 'credit_note') this.assertWithinBalance(computation, balance);

    const result = await this.fiscal.issuePlatformNote({
      note_type: type,
      original,
      computation,
      is_total: isTotal,
      note_concept_code: dto.note_concept_code,
      reason: dto.reason,
      actor_user_id: actorUserId,
    });

    await this.audit.log({
      action: 'CREATE',
      resource: 'fiscal_transmissions',
      resourceId: result.transmission_id,
      oldValues: null,
      newValues: {
        document_type: type,
        related_transmission_id: row.id,
        note_concept_code: dto.note_concept_code,
        reason: dto.reason,
      },
      userId: actorUserId,
      organizationId: ctx.organization_id,
      storeId: undefined,
      metadata: { source: 'platform-fiscal', rail: type },
    });
    return result;
  }

  private assertWithinBalance(c: PlatformNoteComputation, balance: string) {
    if (Number(c.payable) > Number(balance)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CREDIT_NOTE_001,
        `El valor de la nota crédito (${c.payable}) supera el saldo acreditable de la factura (${balance}).`,
        { total: c.payable, balance },
      );
    }
  }

  /** Partial note: the lines the operator typed, with the original's tax. */
  private partialComputation(
    original: PlatformNoteOriginal,
    items: NonNullable<NoteDto['items']>,
  ): PlatformNoteComputation {
    const signature = noteTaxSignature(original.lines);
    if (signature.kind === 'mixed') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        `La factura ${original.document_number} mezcla tarifas de impuesto distintas entre sus líneas: no se puede repartir el impuesto de una nota parcial. Emite una nota crédito total.`,
      );
    }
    const normalized = buildPlatformNoteLines(items as any[], {
      fallback_unit_code: original.lines[0]?.unit_code,
    });
    return this.fiscal.computePlatformInvoiceTotals({
      items: normalized.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        unit_code: l.unit_code,
        taxes:
          signature.kind === 'uniform'
            ? signature.taxes.map((t) => ({ ...t }))
            : [],
      })),
    } as any) as unknown as PlatformNoteComputation;
  }

  /**
   * Notas de una factura, saldo y líneas. Nunca lanza por "no admite notas":
   * responde `can_create_notes=false` con el motivo, para que la pantalla
   * decida qué mostrar sin tratarlo como un fallo.
   */
  async getNotesOverview(id: number): Promise<PlatformNotesOverview> {
    const { row } = await this.loadOriginalTransmission(id);
    const blocked = this.blockedReason(row as any, null);
    const notes = await this.fiscal.listPlatformNotes(row.id);
    if (blocked) {
      return {
        invoice: {
          id: row.id,
          document_number: row.document_number,
          cufe: row.cufe ?? null,
          dian_status: row.dian_status,
          issue_date: null,
          total: '0.00',
          customer_name: null,
        },
        credit_balance: '0.00',
        can_create_notes: false,
        blocked_reason: blocked.message,
        lines: [],
        notes,
      };
    }
    const original = await this.fiscal.loadPlatformNoteOriginal(row as any);
    const credited = await this.fiscal.sumCreditedNotes(row.id);
    return {
      invoice: {
        id: row.id,
        document_number: row.document_number,
        cufe: row.cufe ?? null,
        dian_status: row.dian_status,
        issue_date: original.issue_date,
        total: original.total,
        customer_name:
          (original.customer?.['legal_name'] as string | undefined) ??
          (original.customer?.['name'] as string | undefined) ??
          null,
      },
      credit_balance: creditBalance(original.total, credited),
      can_create_notes: true,
      blocked_reason: null,
      lines: original.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        unit_code: l.unit_code,
        tax_rate: linePercent(l),
      })),
      notes,
    };
  }

  /**
   * Una nota aceptada se envía al cliente de la factura original. Mejor
   * esfuerzo: un fallo de correo no deshace la nota ya aceptada por la DIAN.
   */
  @OnEvent('platform_note.accepted')
  async onNoteAccepted(event: { transmission_id: number }): Promise<void> {
    try {
      await this.delivery.deliverInvoice(event.transmission_id, null, 0);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar por correo la nota ${event.transmission_id}: ${(error as Error)?.message ?? error}`,
      );
    }
  }
}
