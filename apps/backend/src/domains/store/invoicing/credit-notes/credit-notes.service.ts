import { Injectable, Logger } from '@nestjs/common';
// QUI-INC — `tax_type_enum` se importa como VALOR además de como tipo: sus
// miembros (`tax_type_enum.iva`) tienen el tipo literal que el create de
// `invoice_taxes` espera, así que la clasificación fiscal llega al escritor
// sin un solo cast. El `TaxFiscalType` de la capa de dominio refleja los
// mismos seis valores, pero es un enum NOMINAL de TS y no es asignable a la
// unión de literales de Prisma — de ahí venía el `as any` de salida.
import { Prisma, refunds_state_enum, tax_type_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { InvoiceEmissionGateService } from '../services/invoice-emission-gate.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { CreditNoteBalanceService } from './credit-note-balance.service';
import { recalculateNote, type RecalculatedNote } from './recalculate-note.util';
import {
  type NoteSourceInvoiceSnapshot,
  type ResolveNoteSourceOptions,
} from './note-source-resolver.util';
import { resolveEmittedNoteUnitCodes } from './note-source-xml.util';
import { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';
import { NoteContextQueryDto } from './dto/note-context-query.dto';
import { isDianUnitCode } from '../providers/dian-direct/constants/dian-unit-codes';
import {
  deriveRefundNoteSelection,
  type RefundNoteSourceInvoice,
} from './refund-note-source.util';
import {
  CreateCreditNoteDto,
  CreateDebitNoteDto,
} from './dto/create-credit-note.dto';
import { CreateInvoiceItemDto } from '../dto/create-invoice.dto';
import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';
import { RESOLUTION_PUBLIC_SELECT } from '../utils/technical-key.util';
import { assertNoteOriginalHasNoAcceptedRadianEvent } from '../utils/invoice-radian-note-coherence';
import { absorbInclusiveLine } from '../utils/dian-money.util';
import { normalizeInvoiceTaxRate } from '../utils/invoice-tax-rate.util';
import {
  localDateString,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import { REFUND_LEDGER_STATES } from '../../orders/order-flow/services/refund-calculation.service';
import { prorateShippingTaxRefundCents } from '../../shipping/utils/shipping-tax.util';

/**
 * Este servicio NO necesita la ClTec: no calcula CUDE ni arma XML — eso lo hace
 * el emisor cuando la nota se transmite. Por eso la resolución se carga con
 * `RESOLUTION_PUBLIC_SELECT`, la lista blanca que deja las tres columnas de
 * clave técnica fuera de la respuesta (el porqué completo está en su docblock,
 * en `utils/technical-key.util.ts`).
 *
 * Con `resolution: true` la ClTec del rango de notas viajaba al navegador en
 * cada nota crédito o débito creada, exactamente igual que pasaba en las
 * facturas. Es el mismo defecto, en el archivo de al lado.
 */
const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
  related_invoice: {
    select: { id: true, invoice_number: true, invoice_type: true },
  },
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

/**
 * QUI-INC — la fila de impuesto de una nota, TAL COMO LLEGA. `tax_type` es
 * opcional acá porque las tres procedencias posibles lo son en distinto
 * grado: `dto.taxes[]` lo declara opcional, y las dos copias del documento
 * padre lo leen de `invoice_taxes.tax_type`, que es una columna NULLABLE.
 */
interface IncomingNoteTaxRow {
  tax_rate_id?: number;
  tax_name: string;
  tax_rate: number;
  taxable_amount?: number;
  tax_amount?: number;
  tax_type?: string | null;
  /**
   * F-INC6 — índice (0-based) de la línea de la NOTA a la que esta fila
   * pertenece, cuando la factura padre mezcla ≥2 tributos y el desglose se
   * deriva por línea (`resolvePerLineNoteSchemes`). `undefined` = fila de
   * CABECERA (un solo tributo en el documento), la forma histórica.
   *
   * `invoice_taxes.invoice_item_id` documenta que un documento con ≥2
   * tributos exige UNA fila por (línea × tributo), todas ligadas — nunca
   * agregada por tributo — porque el emisor UBL arma el desglose POR LÍNEA
   * leyendo ese vínculo. Sin él, hereda a toda línea el primer tributo del
   * documento. Nunca viaja desde el DTO del cliente: sólo lo puebla el kernel.
   */
  line_index?: number;
}

/**
 * QUI-INC — la misma fila DESPUÉS de resolver el tipo fiscal contra su fila
 * fuente. `tax_type` es obligatorio: una nota crédito es un documento
 * electrónico FIRMADO que va a la DIAN, y acreditar un tributo distinto del
 * que se facturó es un descuadre fiscal, no un detalle de forma.
 */
interface ResolvedNoteTaxRow extends IncomingNoteTaxRow {
  tax_type: tax_type_enum;
}

/**
 * CP-REFUND-FLOW-REDESIGN paso 7 — vínculo refund↔NC resuelto y validado.
 *
 * Contiene sólo los datos refund/order necesarios para que el mapper de
 * provenance derive la selección. La derivación y el puente fiscal no se
 * calculan acá.
 */
interface ResolvedRefundLink {
  refund: {
    id: number;
    order_id: number;
  };
  refund_snapshot: {
    id: number;
    order_id: number;
    shipping_refund: Prisma.Decimal | number | string | null;
    refund_items: Array<{
      id: number;
      order_item_id: number;
      quantity: Prisma.Decimal | number | string | null;
      discount_amount: Prisma.Decimal | number | string | null;
      tax_amount: Prisma.Decimal | number | string | null;
      refund_amount: Prisma.Decimal | number | string | null;
    }>;
  };
  order_items: Array<{
    id: number;
    product_id: number | null;
    product_variant_id: number | null;
    product_name: string;
    quantity: Prisma.Decimal | number | string;
  }>;
  concept_code: '1' | '2';
  default_reason: string;
}

const TAX_TYPE_VALUES: readonly string[] = Object.values(tax_type_enum);

/**
 * Guarda de tipo respaldada por una comprobación REAL contra el catálogo de
 * valores del `tax_type_enum` de Postgres. Es lo que permite estrechar un
 * `string` suelto sin escribir un cast a ciegas.
 */
function isTaxTypeEnum(value: unknown): value is tax_type_enum {
  return typeof value === 'string' && TAX_TYPE_VALUES.includes(value);
}

function assertOnlyKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  reason: string,
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, { reason });
  }
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
      reason,
      forbidden_fields: extra,
    });
  }
}

@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoice_number_generator: InvoiceNumberGenerator,
    private readonly event_emitter: EventEmitter2,
    private readonly fiscalScope: FiscalScopeService,
    private readonly emissionGate: InvoiceEmissionGateService,
    private readonly invoice_flow: InvoiceFlowService,
    private readonly calculator: InvoiceCalculatorService,
    private readonly credit_note_balance: CreditNoteBalanceService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      // B.1 (F-029) — 400 tipado en vez de 500 crudo.
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    return context;
  }

  async createCreditNote(dto: CreateCreditNoteDto) {
    return this.createNote(dto, 'credit_note');
  }

  async createDebitNote(dto: CreateDebitNoteDto) {
    return this.createNote(dto, 'debit_note');
  }

  /**
   * Emite de una una NC/ND que nació en `draft`: corre `validate()` + `send()`
   * con los mismos seams del flujo manual, en una sola llamada.
   *
   * No numera (el consecutivo lo gastó `createNote`) y no acepta otros tipos:
   * validar acá una factura de venta como efecto colateral sería emitir algo
   * que el operador solo quería revisar. El `findFirst` va por `this.prisma,
   * que scopea por tienda, así que una nota ajena responde 404, no 403.
   *
   * Doble clic concurrente: el segundo `validate()` choca con
   * `validateTransition` (INVOICING_STATUS_001) — ver F-001.
   */
  async issueNote(id: number) {
    const note = await this.prisma.invoices.findFirst({
      where: { id },
      select: {
        id: true, invoice_type: true, status: true, related_invoice_id: true,
        organization_id: true, store_id: true, accounting_entity_id: true,
      },
    });

    if (!note) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    if (note.invoice_type !== 'credit_note' && note.invoice_type !== 'debit_note') {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        `Solo una nota crédito o débito puede emitirse de una: el documento #${id} es «${note.invoice_type}» y sigue el flujo manual (validar, enviar).`,
        { invoice_id: id, invoice_type: note.invoice_type },
      );
    }

    await assertNoteOriginalHasNoAcceptedRadianEvent(this.prisma, {
      note_type: note.invoice_type,
      related_invoice_id: note.related_invoice_id,
      organization_id: note.organization_id,
      store_id: note.store_id,
      accounting_entity_id: note.accounting_entity_id,
    });

    await this.invoice_flow.validate(id);
    const sent = await this.invoice_flow.send(id);

    this.logger.log(`Note #${id} (${note.invoice_type}) issued in one shot`);

    return {
      invoice: sent,
      phases: { validated: true, sent: true },
    };
  }

  /**
   * NC/ND de una factura, para las cards de la orden (A.2).
   *
   * La factura padre se resuelve primero por el scope de la tienda: si no es
   * visible, 404 aunque existan notas. Las notas se filtran además por la
   * entidad fiscal del padre, igual que `createNote` exige al crear.
   */
  async findNotesByRelatedInvoice(related_invoice_id: number) {
    const parent = await this.prisma.invoices.findFirst({
      where: { id: related_invoice_id },
      select: { id: true, accounting_entity_id: true },
    });

    if (!parent) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    return this.prisma.invoices.findMany({
      where: {
        related_invoice_id: parent.id,
        accounting_entity_id: parent.accounting_entity_id,
        invoice_type: { in: ['credit_note', 'debit_note'] },
      },
      select: {
        id: true,
        invoice_number: true,
        invoice_type: true,
        fiscal_document_type: true,
        status: true,
        subtotal_amount: true,
        discount_amount: true,
        tax_amount: true,
        total_amount: true,
        currency: true,
        issue_date: true,
        note_concept_code: true,
        created_at: true,
        // El frontend compara `n.refund_id === refund.id` para resaltar la NC
        // ya vinculada a un reembolso puntual (order-details-page.component.ts).
        // Sin esta columna esa comparación siempre da `undefined === id`.
        refund_id: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /** Read-only fiscal defaults for the note composer; it never reserves/creates. */
  async getNoteContext(related_invoice_id: number, note_type: NoteContextQueryDto['note_type']) {
    const context = this.getContext();
    if (typeof context.organization_id !== 'number' || typeof context.store_id !== 'number') {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    const accounting_entity_id = await this.fiscalScope.findFiscalAccountingEntityId({
      organization_id: context.organization_id,
      store_id: context.store_id,
    });
    if (accounting_entity_id === null) {
      throw new VendixHttpException(ErrorCodes.FISCAL_SCOPE_INVALID, undefined, {
        reason: 'source_fiscal_entity_unavailable',
      });
    }
    const sourceInvoice = await this.prisma.invoices.findFirst({
      where: { id: related_invoice_id },
      include: {
        invoice_items: { include: { financial_source_line: { select: { source_order_item_id: true, kind: true } } } },
        invoice_taxes: true,
        profile_snapshot: { select: { config: true } },
      },
    });
    if (!sourceInvoice) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    if (
      sourceInvoice.status !== 'accepted' ||
      !['sales_invoice', 'export_invoice', 'purchase_invoice'].includes(sourceInvoice.invoice_type)
    ) {
      throw new VendixHttpException(ErrorCodes.INVOICING_STATUS_002, undefined, {
        related_invoice_id,
        invoice_type: sourceInvoice.invoice_type,
        status: sourceInvoice.status,
      });
    }
    if (
      sourceInvoice.organization_id !== context.organization_id ||
      sourceInvoice.store_id !== context.store_id ||
      !sourceInvoice.accounting_entity_id ||
      sourceInvoice.accounting_entity_id !== accounting_entity_id
    ) {
      throw new VendixHttpException(ErrorCodes.FISCAL_SCOPE_INVALID, undefined, {
        reason: 'source_fiscal_scope_mismatch', related_invoice_id,
      });
    }
    await assertNoteOriginalHasNoAcceptedRadianEvent(this.prisma, {
      note_type,
      related_invoice_id: sourceInvoice.id,
      organization_id: sourceInvoice.organization_id,
      store_id: sourceInvoice.store_id,
      accounting_entity_id: sourceInvoice.accounting_entity_id,
    });
    const source: NoteSourceInvoiceSnapshot = {
      id: sourceInvoice.id,
      organization_id: sourceInvoice.organization_id,
      store_id: sourceInvoice.store_id,
      accounting_entity_id: sourceInvoice.accounting_entity_id,
      invoice_items: sourceInvoice.invoice_items,
      invoice_taxes: sourceInvoice.invoice_taxes,
      subtotal_amount: sourceInvoice.subtotal_amount,
      discount_amount: sourceInvoice.discount_amount,
      tax_amount: sourceInvoice.tax_amount,
      total_amount: sourceInvoice.total_amount,
      operation_type: sourceInvoice.operation_type,
      aiu_contract_object: sourceInvoice.aiu_contract_object,
      aiu_regime: sourceInvoice.aiu_regime,
      aiu_minimum_percent: sourceInvoice.aiu_minimum_percent,
      aiu_taxable_matrix: sourceInvoice.aiu_taxable_matrix,
      profile_snapshot: sourceInvoice.profile_snapshot ? { config: sourceInvoice.profile_snapshot.config } : null,
    };
    const options: ResolveNoteSourceOptions = {};
    if (source.invoice_items.some((item) => !item.unit_code || !isDianUnitCode(item.unit_code.trim()))) {
      let acceptedXml = sourceInvoice.xml_document;
      if (!acceptedXml) {
        const transmission = await this.prisma.withoutScope().fiscal_transmissions.findFirst({
          where: {
            organization_id: sourceInvoice.organization_id,
            store_id: sourceInvoice.store_id,
            accounting_entity_id: sourceInvoice.accounting_entity_id,
            source_type: 'invoice',
            source_id: sourceInvoice.id,
            document_type: sourceInvoice.invoice_type,
            transmission_status: 'accepted',
            dian_status: 'accepted',
          },
          select: { xml_document: true },
          orderBy: { accepted_at: 'desc' },
        });
        acceptedXml = transmission?.xml_document ?? null;
      }
      if (acceptedXml) Object.assign(options, { emitted_unit_codes: resolveEmittedNoteUnitCodes(source, acceptedXml) });
    }
    const selection: CreateInvoiceNoteItemDto[] = source.invoice_items.map((item) => ({
      source_invoice_item_id: item.id,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      ...(item.unit_code && isDianUnitCode(item.unit_code.trim()) ? { unit_code: item.unit_code.trim() } : {}),
    }));
    const recalculated = recalculateNote(this.calculator, source, selection, options);
    const remaining = note_type === 'credit_note'
      ? await this.credit_note_balance.remaining(source.id)
      : null;
    return {
      invoice_id: source.id,
      note_type,
      items: recalculated.resolved_lines.map((line, index) => {
        const calculatedLine = recalculated.calculated.lines[index];
        const remainingLine = remaining?.lines.get(line.item.source_invoice_item_id);
        return {
          source_invoice_item_id: line.item.source_invoice_item_id,
          description: line.item.description,
          quantity: line.item.quantity.toString(),
          unit_price: line.item.unit_price.toString(),
          discount_amount: line.item.discount_amount.toString(),
          unit_code: line.item.unit_code,
          price_unit_quantity: line.item.price_unit_quantity,
          is_inclusive: line.item.is_inclusive,
          taxes: (calculatedLine?.taxes ?? []).map((tax) => ({
            tax_name: tax.tax_name,
            tax_type: tax.tax_type,
            tax_rate: tax.tax_rate,
            rate_basis: tax.rate_basis,
            is_inclusive: tax.is_inclusive,
          })),
          remaining_quantity: remainingLine?.remaining_quantity.toString() ?? null,
          remaining_base: remainingLine?.remaining_base.toString() ?? null,
          remaining_total: remainingLine?.remaining_total.toString() ?? null,
        };
      }),
      warnings: source.operation_type === '09'
        ? ['La base gravable AIU parcial requiere resolución fiscal del servidor; la previsualización comercial no estima la cuota ni el total AIU.']
        : [],
    };
  }

  /** Calculator-backed production writer; no client tax fields are accepted. */
  private async createNote(
    dto: CreateCreditNoteDto | CreateDebitNoteDto,
    type: 'credit_note' | 'debit_note',
  ) {
    const context = this.getContext();
    if (typeof context.organization_id !== 'number' || typeof context.store_id !== 'number') {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    const accounting_entity_id = await this.fiscalScope.findFiscalAccountingEntityId({
      organization_id: context.organization_id,
      store_id: context.store_id,
    });
    if (accounting_entity_id === null) {
      throw new VendixHttpException(ErrorCodes.FISCAL_SCOPE_INVALID, undefined, {
        reason: 'source_fiscal_entity_unavailable',
      });
    }
    const allowedFields = new Set([
      'related_invoice_id', 'reason', 'notes', 'note_concept_code', 'issue_date',
      'currency', 'items', ...(type === 'credit_note'
        ? ['refund_id', 'refund_item_sources', 'shipping_source_invoice_item_id']
        : []),
    ]);
    assertOnlyKeys(dto, allowedFields, 'note_request_contains_forbidden_fields');
    const rawItems: unknown = dto.items;
    if (rawItems !== undefined && (!Array.isArray(rawItems) || rawItems.length === 0)) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'explicit_empty_or_invalid_source_selection',
      });
    }
    if (Array.isArray(rawItems)) {
      const itemFields = new Set([
        'source_invoice_item_id', 'quantity', 'unit_price', 'discount_amount', 'unit_code',
      ]);
      for (const item of rawItems) assertOnlyKeys(item, itemFields, 'note_item_contains_forbidden_fields');
    }
    const creditDto = dto as CreateCreditNoteDto;
    const hasRefundFields =
      creditDto.refund_id !== undefined ||
      creditDto.refund_item_sources !== undefined ||
      creditDto.shipping_source_invoice_item_id !== undefined;
    if (type !== 'credit_note' && hasRefundFields) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, { reason: 'refund_fields_credit_note_only' });
    }
    const rawRefundMap: unknown = creditDto.refund_item_sources;
    if (rawRefundMap !== undefined && (!Array.isArray(rawRefundMap) || rawRefundMap.length === 0)) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, { reason: 'refund_mapping_invalid' });
    }
    if (Array.isArray(rawRefundMap)) {
      for (const mapping of rawRefundMap) {
        assertOnlyKeys(mapping, new Set(['refund_item_id', 'source_invoice_item_id']), 'refund_mapping_contains_forbidden_fields');
      }
    }

    const related_invoice = await this.prisma.invoices.findFirst({
      where: { id: dto.related_invoice_id },
      include: {
        invoice_items: { include: { financial_source_line: { select: { source_order_item_id: true, kind: true } } } },
        invoice_taxes: true,
        profile_snapshot: { select: { config: true } },
      },
    });
    if (!related_invoice) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);

    const correctable = ['sales_invoice', 'export_invoice', 'purchase_invoice'];
    if (!correctable.includes(related_invoice.invoice_type)) {
      throw new VendixHttpException(ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED, undefined, {
        related_invoice_id: related_invoice.id,
        related_invoice_type: related_invoice.invoice_type,
      });
    }
    if (related_invoice.status !== 'accepted') {
      throw new VendixHttpException(ErrorCodes.INVOICING_STATUS_002,
        `Cannot create ${type} for invoice in '${related_invoice.status}' status. Invoice must be accepted by DIAN first.`);
    }
    if (
      related_invoice.organization_id !== context.organization_id ||
      related_invoice.store_id !== context.store_id ||
      !related_invoice.accounting_entity_id ||
      related_invoice.accounting_entity_id !== accounting_entity_id
    ) {
      throw new VendixHttpException(ErrorCodes.FISCAL_SCOPE_INVALID, undefined, {
        reason: 'source_fiscal_scope_mismatch',
        related_invoice_id: related_invoice.id,
      });
    }
    await assertNoteOriginalHasNoAcceptedRadianEvent(this.prisma, {
      note_type: type,
      related_invoice_id: related_invoice.id,
      organization_id: related_invoice.organization_id,
      store_id: related_invoice.store_id,
      accounting_entity_id: related_invoice.accounting_entity_id,
    });
    if (dto.currency !== undefined && dto.currency !== related_invoice.currency) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'note_currency_must_match_source', parent_invoice_id: related_invoice.id,
      });
    }

    const source: RefundNoteSourceInvoice = {
      id: related_invoice.id,
      organization_id: related_invoice.organization_id,
      store_id: related_invoice.store_id,
      accounting_entity_id: related_invoice.accounting_entity_id,
      invoice_items: related_invoice.invoice_items,
      invoice_taxes: related_invoice.invoice_taxes,
      subtotal_amount: related_invoice.subtotal_amount,
      discount_amount: related_invoice.discount_amount,
      tax_amount: related_invoice.tax_amount,
      total_amount: related_invoice.total_amount,
      operation_type: related_invoice.operation_type,
      aiu_contract_object: related_invoice.aiu_contract_object,
      aiu_regime: related_invoice.aiu_regime,
      aiu_minimum_percent: related_invoice.aiu_minimum_percent,
      aiu_taxable_matrix: related_invoice.aiu_taxable_matrix,
      profile_snapshot: related_invoice.profile_snapshot
        ? { config: related_invoice.profile_snapshot.config }
        : null,
    };
    const options: ResolveNoteSourceOptions = {};
    if (source.invoice_items.some((item) => !item.unit_code || !isDianUnitCode(item.unit_code.trim()))) {
      let acceptedXml = related_invoice.xml_document;
      if (!acceptedXml) {
        const transmission = await this.prisma.withoutScope().fiscal_transmissions.findFirst({
          where: {
            organization_id: related_invoice.organization_id,
            store_id: related_invoice.store_id,
            accounting_entity_id: related_invoice.accounting_entity_id,
            source_type: 'invoice',
            source_id: related_invoice.id,
            document_type: related_invoice.invoice_type,
            transmission_status: 'accepted',
            dian_status: 'accepted',
          },
          select: { xml_document: true },
          orderBy: { accepted_at: 'desc' },
        });
        acceptedXml = transmission?.xml_document ?? null;
      }
      if (acceptedXml) {
        Object.assign(options, { emitted_unit_codes: resolveEmittedNoteUnitCodes(source, acceptedXml) });
      }
    }

    const hasRefundMapping = creditDto.refund_item_sources !== undefined ||
      creditDto.shipping_source_invoice_item_id !== undefined;
    const refundId = creditDto.refund_id;
    if (hasRefundFields && refundId == null) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'refund_fields_require_refund_id', parent_invoice_id: related_invoice.id,
      });
    }
    if (hasRefundMapping && refundId === undefined) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'refund_mapping_requires_refund_id', parent_invoice_id: related_invoice.id,
      });
    }
    if (refundId !== undefined && dto.items !== undefined) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'refund_and_manual_items_are_mutually_exclusive', parent_invoice_id: related_invoice.id,
      });
    }
    let refund_link: ResolvedRefundLink | null = null;
    let refund_selection: ReturnType<typeof deriveRefundNoteSelection> | undefined;
    if (refundId !== undefined) {
      refund_link = await this.resolveRefundLink(dto, type, {
        id: related_invoice.id,
        order_id: related_invoice.order_id,
      });
      if (!refund_link) {
        throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
          reason: 'refund_link_missing', parent_invoice_id: related_invoice.id,
        });
      }
      refund_selection = deriveRefundNoteSelection(
        this.calculator,
        source,
        refund_link.refund_snapshot,
        refund_link.order_items,
        {
          ...(creditDto.refund_item_sources !== undefined
            ? { refund_item_sources: creditDto.refund_item_sources }
            : {}),
          ...(creditDto.shipping_source_invoice_item_id !== undefined
            ? { shipping_source_invoice_item_id: creditDto.shipping_source_invoice_item_id }
            : {}),
        },
        options,
      );
    }
    const recalculated: RecalculatedNote = recalculateNote(
      this.calculator,
      source,
      refund_selection?.items ?? (dto.items as readonly CreateInvoiceNoteItemDto[] | undefined),
      options,
    );
    let foreignTotalAmount = related_invoice.foreign_total_amount;
    const isExactTotal = dto.items === undefined && !refund_link;
    if (!isExactTotal && related_invoice.foreign_currency) {
      let exchangeRate: Prisma.Decimal;
      try {
        exchangeRate = new Prisma.Decimal(related_invoice.exchange_rate ?? 'NaN');
      } catch {
        throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
          reason: 'source_foreign_exchange_rate_unavailable', parent_invoice_id: related_invoice.id,
        });
      }
      if (!exchangeRate.isFinite() || exchangeRate.lte(0)) {
        throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
          reason: 'source_foreign_exchange_rate_unavailable', parent_invoice_id: related_invoice.id,
        });
      }
      foreignTotalAmount = recalculated.total_amount
        .dividedBy(exchangeRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      if (
        !foreignTotalAmount.isFinite() ||
        foreignTotalAmount.isNegative() ||
        foreignTotalAmount.greaterThan(new Prisma.Decimal('999999999999.99'))
      ) {
        throw new VendixHttpException(ErrorCodes.INVOICING_CALC_006, undefined, {
          detail: 'foreign_total_amount_outside_database_precision',
        });
      }
    }
    for (const [index, taxRow] of recalculated.taxes.entries()) {
      if (taxRow.taxable_amount == null || taxRow.tax_amount == null) {
        throw new VendixHttpException(ErrorCodes.INVOICING_CALC_006, undefined, {
          detail: 'persisted_tax_amount_missing', tax_index: index,
        });
      }
      if (taxRow.line_index !== undefined &&
        (!Number.isInteger(taxRow.line_index) || taxRow.line_index < 0 || taxRow.line_index >= recalculated.resolved_lines.length)) {
        throw new VendixHttpException(ErrorCodes.INVOICING_CALC_006, undefined, {
          detail: 'tax_line_index_out_of_range', tax_index: index, line_index: taxRow.line_index,
        });
      }
    }
    if (type === 'credit_note') {
      await this.credit_note_balance.assertCanCreate(related_invoice.id, recalculated.candidate);
    }
    await this.emissionGate.assertAreaActive({ organization_id: context.organization_id, store_id: context.store_id });
    const issue_date = dto.issue_date
      ? new Date(dto.issue_date)
      : new Date(localDateString(new Date(), await resolveStoreTimezone(this.prisma, context.store_id!)));
    const { invoice_number, resolution_id } = await this.invoice_number_generator.generateNextNumber({
      document_type: type,
      accounting_entity_id: related_invoice.accounting_entity_id,
    });

    try {
      const note = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.invoices.create({
          data: {
            organization_id: context.organization_id!,
            store_id: context.store_id!,
            accounting_entity_id: related_invoice.accounting_entity_id,
            fiscal_document_type: type,
            invoice_number,
            invoice_type: type,
            status: 'draft',
            customer_id: related_invoice.customer_id,
            customer_name: related_invoice.customer_name,
            customer_tax_id: related_invoice.customer_tax_id,
            customer_address: related_invoice.customer_address ?? Prisma.DbNull,
            customer_document_type: related_invoice.customer_document_type,
            customer_verification_digit: related_invoice.customer_verification_digit,
            customer_email: related_invoice.customer_email,
            customer_phone: related_invoice.customer_phone,
            customer_tax_regime: related_invoice.customer_tax_regime,
            customer_fiscal_responsibilities: related_invoice.customer_fiscal_responsibilities ?? Prisma.DbNull,
            customer_person_type: related_invoice.customer_person_type,
            related_invoice_id: related_invoice.id,
            resolution_id,
            subtotal_amount: recalculated.subtotal_amount,
            discount_amount: recalculated.discount_amount,
            tax_amount: recalculated.tax_amount,
            total_amount: recalculated.total_amount,
            currency: related_invoice.currency,
            foreign_currency: related_invoice.foreign_currency,
            foreign_total_amount: foreignTotalAmount,
            exchange_rate: related_invoice.exchange_rate,
            exchange_rate_date: related_invoice.exchange_rate_date,
            operation_type: related_invoice.operation_type,
            aiu_contract_object: related_invoice.aiu_contract_object,
            aiu_regime: related_invoice.aiu_regime,
            aiu_minimum_percent: related_invoice.aiu_minimum_percent,
            aiu_taxable_matrix: recalculated.aiu_taxable_matrix ?? related_invoice.aiu_taxable_matrix ?? Prisma.DbNull,
            profile_id: related_invoice.profile_id,
            profile_version: related_invoice.profile_version,
            issue_date,
            created_by_user_id: context.user_id,
            notes: dto.notes || dto.reason || refund_link?.default_reason || null,
            refund_id: refund_link?.refund.id ?? null,
            note_concept_code: dto.note_concept_code ?? refund_link?.concept_code ?? null,
          },
        });
        await tx.invoice_items.createMany({
          data: recalculated.items.map((item) => ({ ...item, invoice_id: created.id })),
        });
        const createdItems = await tx.invoice_items.findMany({
          where: { invoice_id: created.id },
          select: { id: true, source_invoice_item_id: true },
          orderBy: { id: 'asc' },
        });
        const createdBySource = new Map(createdItems.map((item) => [item.source_invoice_item_id, item.id]));
        const taxRows = recalculated.taxes.map((taxRow) => {
          const sourceItemId = taxRow.line_index === undefined
            ? undefined
            : recalculated.resolved_lines[taxRow.line_index]?.item.source_invoice_item_id;
          const invoiceItemId = sourceItemId === undefined ? null : createdBySource.get(sourceItemId);
          if (sourceItemId !== undefined && invoiceItemId === undefined) {
            throw new VendixHttpException(ErrorCodes.INVOICING_CALC_006, undefined, {
              detail: 'created_tax_line_missing', source_invoice_item_id: sourceItemId,
            });
          }
          return {
            invoice_id: created.id,
            tax_rate_id: taxRow.tax_rate_id,
            tax_name: taxRow.tax_name,
            tax_rate: taxRow.tax_rate,
            taxable_amount: taxRow.taxable_amount,
            tax_amount: taxRow.tax_amount,
            tax_type: taxRow.tax_type,
            is_inclusive: taxRow.is_inclusive,
            invoice_item_id: invoiceItemId ?? null,
          };
        });
        if (taxRows.length > 0) await tx.invoice_taxes.createMany({ data: taxRows });
        if (refund_selection && refund_selection.bridge_rows.length > 0) {
          await tx.credit_note_refund_items.createMany({
            data: refund_selection.bridge_rows.map((row) => ({
              credit_note_id: created.id,
              refund_item_id: row.refund_item_id,
              covered_qty: row.covered_qty,
              covered_amount: row.covered_amount,
            })),
            skipDuplicates: false,
          });
        }
        const refetched = await tx.invoices.findFirst({
          where: {
            id: created.id,
            organization_id: context.organization_id,
            store_id: context.store_id,
            accounting_entity_id: related_invoice.accounting_entity_id,
          },
          include: INVOICE_INCLUDE,
        });
        if (!refetched) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
        return refetched;
      });
      this.event_emitter.emit('invoice.created', {
        invoice_id: note.id,
        invoice_number: note.invoice_number,
        invoice_type: type,
        related_invoice_id: related_invoice.id,
      });
      this.logger.log(`${type === 'credit_note' ? 'Credit' : 'Debit'} note ${note.invoice_number} created for invoice #${related_invoice.id}`);
      return note;
    } catch (error) {
      throw await this.throwIfDuplicateRefundLink(error, refund_link);
    }
  }

  /**
   * Release-853 (paso 8) — traduce el P2002 del índice parcial único
   * `invoices_refund_id_active_credit_note_key` al error de "refund ya
   * vinculado" de la guarda pre-vuelo. La guarda no cierra la carrera
   * (doble clic / dos operadores); el índice sí, y sin esta traducción la
   * carrera respondería 500. El re-chequeo distingue el conflicto real de
   * un P2002 ajeno (consecutivo): sólo se traduce si el vínculo vivo
   * existe AHORA. Cualquier otro error se relanza intacto.
   */
  private async throwIfDuplicateRefundLink(
    error: unknown,
    refund_link: ResolvedRefundLink | null,
  ): Promise<never> {
    if (refund_link && (error as { code?: string })?.code === 'P2002') {
      const live_link = await this.prisma.invoices.findFirst({
        where: {
          refund_id: refund_link.refund.id,
          invoice_type: 'credit_note',
          OR: [
            { status: { in: ['draft', 'validated', 'sent', 'accepted'] } },
            { credit_limit_reserved_at: { not: null } },
            { transmission_status: { in: ['queued', 'signing', 'signed', 'submitted', 'retrying', 'error', 'contingency'] } },
          ],
        },
        select: { id: true, invoice_number: true, status: true },
      });
      if (live_link) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_CALC_001,
          `El reembolso #${refund_link.refund.id} ya lo acredita la nota crédito ${live_link.invoice_number ?? `#${live_link.id}`} (estado «${live_link.status}»). Anula esa nota antes de emitir otra sobre el mismo reembolso.`,
          {
            refund_id: refund_link.refund.id,
            credit_note_id: live_link.id,
            credit_note_status: live_link.status,
          },
        );
      }
    }
    throw error;
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 7 — resuelve y valida el vínculo
   * refund↔NC de una nota guiada.
   *
   * El mapeo `refund_items` → líneas es el ADR-03 del order-details
   * (frontend), movido a backend: cantidad y montos del reembolso, precio
   * y descripción de la línea de la orden. Nunca re-deriva impuestos acá —
   * las líneas entran al carril parcial por kernel como cualquier otra.
   *
   * Todo rechazo sale ANTES de numerar (el llamador numera después):
   * refund inexistente/ajeno, factura padre sin orden, cruce de órdenes,
   * doble vínculo vivo, mezcla guiada+explícita, y refund sin nada que
   * derivar. Null = NC manual, el flujo histórico intacto.
   */
  private async resolveRefundLink(
    dto: CreateCreditNoteDto | CreateDebitNoteDto,
    type: 'credit_note' | 'debit_note',
    related_invoice: { id: number; order_id: number | null },
  ): Promise<ResolvedRefundLink | null> {
    const refund_id = (dto as CreateCreditNoteDto).refund_id;
    if (refund_id == null) return null;
    if (type !== 'credit_note') {
      throw new VendixHttpException(ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED, undefined, { refund_id });
    }
    if (dto.items !== undefined) {
      throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
        reason: 'refund_and_manual_items_are_mutually_exclusive', refund_id,
      });
    }
    const refund = await this.prisma.refunds.findFirst({
      where: { id: refund_id },
      include: { refund_items: true },
    });
    if (!refund) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    if (!(REFUND_LEDGER_STATES as readonly string[]).includes(refund.state)) {
      throw new VendixHttpException(ErrorCodes.INVOICING_CALC_001, undefined, {
        refund_id: refund.id, refund_state: refund.state,
      });
    }
    if (related_invoice.order_id == null) {
      throw new VendixHttpException(ErrorCodes.INVOICING_CALC_001, undefined, {
        refund_id: refund.id, related_invoice_id: related_invoice.id, reason: 'source_invoice_has_no_order',
      });
    }
    if (refund.order_id !== related_invoice.order_id) {
      throw new VendixHttpException(ErrorCodes.INVOICING_CALC_001, undefined, {
        refund_id: refund.id,
        refund_order_id: refund.order_id,
        related_invoice_id: related_invoice.id,
        invoice_order_id: related_invoice.order_id,
      });
    }

    const live_link = await this.prisma.invoices.findFirst({
      where: {
        refund_id: refund.id,
        invoice_type: 'credit_note',
        OR: [
          { status: { in: ['draft', 'validated', 'sent', 'accepted'] } },
          { credit_limit_reserved_at: { not: null } },
          { transmission_status: { in: ['queued', 'signing', 'signed', 'submitted', 'retrying', 'error', 'contingency'] } },
        ],
      },
      select: { id: true, invoice_number: true, status: true },
    });
    if (live_link) {
      throw new VendixHttpException(ErrorCodes.INVOICING_CALC_001, undefined, {
        refund_id: refund.id,
        credit_note_id: live_link.id,
        credit_note_status: live_link.status,
      });
    }

    // Identity/lineage snapshot only. Prices and fiscal values are never read
    // from order rows; refund amounts and source-invoice snapshots are the inputs.
    const order_items = await this.prisma.order_items.findMany({
      where: { order_id: refund.order_id },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        product_name: true,
        quantity: true,
      },
    });
    const covers_whole_order = order_items.length > 0 && order_items.every((orderItem) => {
      const refundedQuantity = refund.refund_items.find((row) => row.order_item_id === orderItem.id)?.quantity ?? 0;
      return new Prisma.Decimal(refundedQuantity).greaterThanOrEqualTo(new Prisma.Decimal(orderItem.quantity));
    });
    const default_reason = (
      `Reembolso #${refund.id} de la orden #${refund.order_id}` +
      (refund.reason ? ` — ${refund.reason}` : '')
    ).slice(0, 500);

    return {
      refund: { id: refund.id, order_id: refund.order_id },
      refund_snapshot: {
        id: refund.id,
        order_id: refund.order_id,
        shipping_refund: refund.shipping_refund,
        refund_items: refund.refund_items.map((item) => ({
          id: item.id,
          order_item_id: item.order_item_id,
          quantity: item.quantity,
          discount_amount: item.discount_amount,
          tax_amount: item.tax_amount,
          refund_amount: item.refund_amount,
        })),
      },
      order_items: order_items.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        product_name: item.product_name ?? '',
        quantity: item.quantity,
      })),
      concept_code: covers_whole_order ? '2' : '1',
      default_reason,
    };
  }

  private async resolveRefundShippingLine(refund: {
    id: number;
    order_id: number;
    shipping_refund: Prisma.Decimal | number | null;
  }): Promise<CreateInvoiceItemDto> {
    const shipping_refund = Number(refund.shipping_refund ?? 0);
    const plain_line = (): CreateInvoiceItemDto => ({
      description: `Reembolso de envío — orden #${refund.order_id}`,
      quantity: 1,
      unit_price: shipping_refund,
      discount_amount: 0,
      tax_amount: 0,
    });
    const order = await this.prisma.orders.findFirst({
      where: { id: refund.order_id },
      select: { shipping_cost: true, shipping_tax_amount: true },
    });
    const shipping_tax_cents = Math.round(
      (Number(order?.shipping_tax_amount ?? 0) || 0) * 100,
    );
    if (shipping_tax_cents <= 0) return plain_line();
    const shipping_cost_cents = Math.round(
      (Number(order?.shipping_cost ?? 0) || 0) * 100,
    );
    const prior_refunds = await this.prisma.refunds.findMany({
      where: {
        order_id: refund.order_id,
        id: { not: refund.id },
        state: refunds_state_enum.completed,
      },
      select: { shipping_refund: true },
    });
    const prior_cents = (prior_refunds ?? [])
      .map((row) => Math.round(Number(row.shipping_refund ?? 0) * 100))
      .filter((cents) => cents > 0);
    const hint_cents = prorateShippingTaxRefundCents(
      shipping_cost_cents,
      shipping_tax_cents,
      prior_cents,
      Math.round(shipping_refund * 100),
    );
    return {
      ...plain_line(),
      tax_amount: hint_cents / 100,
      is_inclusive: true,
    };
  }

  private async resolveNoteTaxTypes(
    rows: IncomingNoteTaxRow[],
    related_invoice_id: number,
    document_type: 'credit_note' | 'debit_note',
    store_id: number | null,
  ): Promise<ResolvedNoteTaxRow[]> {
    if (rows.length === 0) return [];

    const pending_rate_ids = [
      ...new Set(
        rows
          .filter((row) => !isTaxTypeEnum(row.tax_type))
          .map((row) => row.tax_rate_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];

    const catalog = new Map<number, tax_type_enum>();
    if (pending_rate_ids.length > 0) {
      const catalog_rows = await this.prisma.withoutScope().tax_rates.findMany({
        where: {
          id: { in: pending_rate_ids },
          ...(store_id != null
            ? { OR: [{ store_id }, { store_id: null }] }
            : {}),
        },
        select: {
          id: true,
          tax_categories: { select: { tax_type: true } },
        },
      });
      for (const rate of catalog_rows) {
        // La categoría es la fila fuente: acá —y sólo acá— «sin tipar
        // significa IVA» es una lectura, no una fabricación.
        catalog.set(
          rate.id,
          rate.tax_categories?.tax_type ?? tax_type_enum.iva,
        );
      }
    }

    return rows.map((row, index) => {
      if (isTaxTypeEnum(row.tax_type)) {
        return { ...row, tax_type: row.tax_type };
      }
      const resolved =
        row.tax_rate_id != null ? catalog.get(row.tax_rate_id) : undefined;
      if (resolved !== undefined) {
        return { ...row, tax_type: resolved };
      }
      throw new VendixHttpException(
        ErrorCodes.NOTE_TAX_TYPE_UNRESOLVABLE_001,
        `El impuesto «${row.tax_name}» de la nota no declara tipo fiscal y no hay ` +
          'fila de catálogo de la cual deducirlo. Envía `tax_type` (iva/inc/ica/...) ' +
          'o un `tax_rate_id` que exista en esta tienda: una nota que acredita un ' +
          'tributo distinto del que se facturó descuadra la declaración.',
        {
          tax_index: index,
          tax_name: row.tax_name,
          tax_rate_id: row.tax_rate_id ?? null,
          related_invoice_id,
          document_type,
        },
      );
    });
  }

  /**
   * Rechaza la nota crédito que excede el saldo acreditable que le queda a su
   * factura padre.
   *
   * ## El límite es del CONJUNTO, no de cada nota
   *
   * Tres notas del 50 % sobre una factura de $100 acreditan $150 sobre $100
   * facturados, y **cada una cabe por separado**: comparar cada nota contra el
   * `total_amount` bruto del padre las deja pasar a las tres. Por eso el
   * cálculo parte del SALDO RESTANTE —total del padre menos lo ya acreditado—
   * y no del total bruto.
   *
   * ## Sólo cuentan las `accepted`
   *
   * Una nota es vigente cuando la DIAN la aceptó. `draft` todavía no se
   * transmitió, `rejected` la devolvieron, y `cancelled`/`voided` dejaron de
   * surtir efecto: ninguna acreditó un peso, así que ninguna consume saldo.
   * Contarlas convertiría un borrador abandonado en un techo permanente sobre
   * la factura.
   *
   * ## Helper propio, no `findNotesByRelatedInvoice`
   *
   * Aquel método es el lector de las cards de la orden (A.2) y devuelve NC y
   * ND de TODOS los estados a propósito: el operador tiene que ver la nota
   * rechazada. Meterle un `status: 'accepted'` para reciclarlo acá le cambiaría
   * la respuesta a su consumidor de lectura, que es un contrato distinto del
   * que necesita esta guarda. Se prefiere una consulta propia de diez líneas
   * antes que un `where` compartido que sirva a medias a dos llamadores.
   *
   * Todo en `Decimal`: comparar saldos en `number` es de donde salen los
   * centavos que se cuelan o se rechazan de más.
   */
  private async assertWithinCreditableBalance(
    parent: {
      id: number;
      invoice_number: string;
      total_amount: Prisma.Decimal;
      accounting_entity_id: number;
    },
    note_total: Prisma.Decimal,
  ): Promise<void> {
    const prior_notes = await this.prisma.invoices.findMany({
      where: {
        related_invoice_id: parent.id,
        accounting_entity_id: parent.accounting_entity_id,
        invoice_type: 'credit_note',
        status: 'accepted',
      },
      select: { id: true, invoice_number: true, total_amount: true },
    });

    const already_credited = prior_notes.reduce(
      (acc, note) => acc.plus(new Prisma.Decimal(note.total_amount ?? 0)),
      new Prisma.Decimal(0),
    );
    const parent_total = new Prisma.Decimal(parent.total_amount ?? 0);
    const remaining = parent_total.minus(already_credited);

    // F-INC6 — redondeo a CENTAVOS antes de comparar. `note_total` ya llega
    // en `Decimal` desde el llamador (Fix A eliminó la fuga de float), pero
    // esta guarda es la última línea de defensa: si algún carril futuro
    // vuelve a filtrar un residuo sub-centavo (p. ej. 3900.0000000000005), el
    // redondeo a 2 decimales lo absorbe antes de comparar contra el saldo —
    // que sale de columnas `Decimal(12,2)` y siempre está exacto a centavos.
    const note_total_cents = note_total.toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    if (note_total_cents.lessThanOrEqualTo(remaining)) return;

    throw new VendixHttpException(
      ErrorCodes.INVOICING_CREDIT_NOTE_001,
      `La nota crédito de ${note_total_cents.toString()} excede el saldo acreditable de la factura ${parent.invoice_number}: ` +
        `de ${parent_total.toString()} facturados ya hay ${already_credited.toString()} acreditados en ${prior_notes.length} nota(s) aceptada(s), ` +
        `así que quedan ${remaining.toString()}. Emite la nota por ese saldo o menos.`,
      {
        related_invoice_id: parent.id,
        related_invoice_number: parent.invoice_number,
        parent_total: parent_total.toString(),
        already_credited: already_credited.toString(),
        remaining: remaining.toString(),
        attempted: note_total_cents.toString(),
        accepted_note_ids: prior_notes.map((note) => note.id),
      },
    );
  }

  /**
   * Rechaza una nota cuyas líneas referencian artículos que el catálogo de esta
   * tienda no devuelve.
   *
   * Sólo mira `dto.items`. Las líneas de la nota TOTAL se copian de
   * `related_invoice.invoice_items`, cuyos ids ya satisfacen la FK por
   * construcción: volver a consultarlos sería una consulta por nota para
   * confirmar algo que la base ya garantiza.
   *
   * Las dos consultas van por `this.prisma`, que scopea `products` por tienda y
   * `product_variants` por relación. Por eso «no está en el mapa» significa a la
   * vez «no existe» y «es de otra tienda», y por eso un solo control cierra los
   * dos agujeros: el 500 por FK y la fuga de tenant que respondía 201.
   *
   * 422 y no 404: no falta el recurso que se pidió —la nota se está creando—,
   * sino que el cuerpo referencia uno que no es de quien escribe.
   */
  private async assertNoteLinesResolvable(
    items: readonly CreateInvoiceItemDto[] | undefined,
  ): Promise<void> {
    if (!items?.length) return;

    const product_ids = [
      ...new Set(
        items
          .map((item) => item.product_id)
          .filter((id): id is number => id != null),
      ),
    ];
    const variant_ids = [
      ...new Set(
        items
          .map((item) => item.product_variant_id)
          .filter((id): id is number => id != null),
      ),
    ];
    if (!product_ids.length && !variant_ids.length) return;

    const [products, variants] = await Promise.all([
      product_ids.length
        ? this.prisma.products.findMany({
            where: { id: { in: product_ids } },
            select: { id: true },
          })
        : Promise.resolve([]),
      variant_ids.length
        ? this.prisma.product_variants.findMany({
            where: { id: { in: variant_ids } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const found_products = new Set(products.map((p) => p.id));
    const found_variants = new Set(variants.map((v) => v.id));
    const rejected_products = product_ids.filter((id) => !found_products.has(id));
    const rejected_variants = variant_ids.filter((id) => !found_variants.has(id));
    if (!rejected_products.length && !rejected_variants.length) return;

    const parts = [
      rejected_products.length
        ? `producto(s) ${rejected_products.join(', ')}`
        : null,
      rejected_variants.length
        ? `variante(s) ${rejected_variants.join(', ')}`
        : null,
    ].filter(Boolean);
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_003,
      `La nota referencia ${parts.join(' y ')} que no existen en el catálogo de esta tienda. ` +
        'Selecciónalos desde el buscador de productos, o deja la línea sin producto si es un ítem libre.',
      {
        rejected_product_ids: rejected_products,
        rejected_product_variant_ids: rejected_variants,
      },
    );
  }
}

/**
 * Línea parcial derivada por el kernel (B.1, F-020): base, cuota y total en
 * `Decimal`, listos para persistir.
 */
export interface DerivedPartialNoteLine {
  base_amount: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  is_inclusive: boolean;
  /**
   * F-INC6 — precio unitario en FORMA BASE (nunca bruto), a la MISMA escala
   * que el `unit_price` de entrada (mismo divisor que la gemela): lo que
   * `invoice_items.unit_price` debe persistir, sea o no inclusiva la línea
   * de origen. Back-solve: `(base + descuento) × divisor / cantidad` — para
   * una línea NO inclusiva esto es una identidad (no-op); para una inclusiva
   * despoja el impuesto que antes quedaba mezclado en el bruto persistido.
   */
  unit_price: Prisma.Decimal;
  /** Snapshot de la gemela, propagado tal cual (ver `invoice_items` schema). */
  unit_code: string | null;
  price_unit_quantity: number | null;
  stock_units_consumed: number | null;
}

/**
 * Nota PARCIAL sin desglose de impuestos propio, derivada por el kernel.
 *
 * B.1 (F-020) — antes esta rama sumaba floats y persistía el `tax_amount`
 * del cliente, que puede violar `cuota = trunc(base × rate)` y quemar el
 * consecutivo en DIAN (una parcial sobre línea absorbida de $3.000 → base
 * 2777.78 + 222.22 salía con cualquier otro reparto que el cliente mandara).
 * Ahora cada línea pasa por `absorbInclusiveLine` —el mismo loop del motor—:
 * la cuota que se persiste ES `trunc(base_final × rate)` por construcción, y
 * la cabecera suma lo derivado, nunca el reclamo.
 *
 * Lo que NO cambia (copia exacta): la nota TOTAL (sin `dto.items`) copia
 * líneas e impuestos de la factura que corrige tal cual; el desglose
 * explícito (`dto.taxes`) manda sobre lo derivado.
 *
 * Falla cerrada ANTES de numerar (el llamador numera después): entrada
 * inválida ⇒ `INVOICING_CALC_006`; bruto inalcanzable ⇒ `INVOICING_CALC_005`.
 * Sin cuota derivada no hay nada que respaldar: líneas exentas o excluidas
 * salen sin `cac:TaxTotal`, que es exactamente lo que el Anexo 1.9 pide.
 *
 * La inclusividad de cada línea sale del DTO (`is_inclusive` de la línea o
 * de su primer impuesto, herencia del motor) y, en su defecto, de la línea
 * de la factura que corrige (misma pareja producto+variante, o la única
 * línea cuando la factura trae una sola). Sin dato ⇒ adicional (default
 * histórico). Las líneas de nota no traen `price_unit_quantity` (el DTO no
 * lo trae), así que el divisor se lee de la línea gemela de la factura
 * (`divisor_for`, N3 y —desde R3-01— también N2): el precio del DTO copia la
 * escala de la factura (paquete de 12 a $36000, no $3000/unidad).
 */
/**
 * Agrupa las filas de `invoice_taxes` por tributo (tipo fiscal normalizado,
 * untyped ⇒ iva) + tarifa. Conserva la PRIMERA fila de cada grupo como
 * representante (su `tax_rate_id`/`tax_name` viajan a la fila de la nota).
 */
export function distinctInvoiceTaxSchemes<
  T extends { tax_type: string | null; tax_rate: Prisma.Decimal | number },
>(invoice_taxes: T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of invoice_taxes) {
    const type = (row.tax_type ?? '').trim().toLowerCase() || 'iva';
    const key = `${type}|${Number(row.tax_rate).toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return Array.from(seen.values());
}

export function derivePartialNoteLinesViaKernel(
  items: Array<{
    product_id?: number | null;
    product_variant_id?: number | null;
    description?: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number | null;
    tax_amount?: number | null;
    is_inclusive?: boolean | null;
    taxes?: Array<{ is_inclusive?: boolean | null }> | null;
  }>,
  related_items: Array<{
    /**
     * Id de la línea de la factura. Sólo lo usa el carril de esquemas
     * mezclados: las filas de `invoice_taxes` ligadas por `invoice_item_id` a
     * la gemela dicen qué tributo lleva ESA línea.
     */
    id?: number | null;
    product_id: number | null;
    product_variant_id: number | null;
    is_inclusive: boolean | null;
    // N1/N3 (round 2): la fila real trae más columnas; el kernel sólo lee
    // estas dos para exención por gemela y divisor de presentación.
    tax_amount?: Prisma.Decimal | number | null;
    price_unit_quantity?: Prisma.Decimal | number | null;
    // Sólo para reconocer una nota que acredita la línea COMPLETA y heredar
    // su cuota persistida (ver `fullTwinQuota`).
    quantity?: Prisma.Decimal | number | null;
    unit_price?: Prisma.Decimal | number | null;
    discount_amount?: Prisma.Decimal | number | null;
    // F-INC6 — snapshot a propagar tal cual a la línea de la nota, y
    // `total_amount` para que `twinIsGenuinelyInclusive` pueda leer la cuota
    // YA declarada de la gemela sin depender de que venga en `tax_amount`.
    total_amount?: Prisma.Decimal | number | null;
    unit_code?: string | null;
    stock_units_consumed?: number | null;
  }>,
  invoice_taxes: Array<{
    tax_rate_id: number | null;
    tax_name: string;
    tax_rate: Prisma.Decimal | number;
    tax_type: string | null;
    invoice_item_id?: number | null;
  }>,
  related_invoice_id: number,
  type: 'credit_note' | 'debit_note',
  logger?: { warn(message: string): void },
): {
  taxes: Array<{
    tax_rate_id: number | undefined;
    tax_name: string;
    tax_rate: number;
    taxable_amount: number;
    tax_amount: number;
    tax_type: string | null;
    line_index?: number;
  }>;
  lines: DerivedPartialNoteLine[];
  totals: {
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
  };
} {
  // Gemela de la factura por pareja producto+variante (o la única línea).
  // Vive arriba porque N2 y N3 la usan: ambas escalas leen la MISMA gemela.
  const single_related =
    related_items.length === 1 ? related_items[0] : undefined;
  const match_related = (item: {
    product_id?: number | null;
    product_variant_id?: number | null;
  }): (typeof related_items)[number] | undefined =>
    related_items.find(
      (rel) =>
        (rel.product_id ?? null) === (item.product_id ?? null) &&
        (rel.product_variant_id ?? null) ===
          (item.product_variant_id ?? null),
    ) ?? single_related;
  // N3 (round 2, R3-01 también en N2): el divisor sale de la línea gemela
  // de la factura (el DTO no lo trae); sin gemela ⇒ 1.
  const divisor_for = (item: {
    product_id?: number | null;
    product_variant_id?: number | null;
  }): number => {
    const divisor_raw = Number(
      (match_related(item) as { price_unit_quantity?: unknown } | undefined)
        ?.price_unit_quantity ?? 1,
    );
    return Number.isFinite(divisor_raw) && divisor_raw >= 1
      ? Math.floor(divisor_raw)
      : 1;
  };
  // Un MISMO tributo puede venir en varias filas de `invoice_taxes`: desde el
  // domicilio con INC (restaurante O-33) la factura de 1 plato + envío trae dos
  // filas «INC 8%» (la del plato y la ligada al Envío). El despeje sólo necesita
  // tipo + tarifa, así que se agrupa por ese par (untyped ⇒ iva, tarifa a 4
  // decimales) antes de decidir si el esquema es único. Una factura de una fila
  // se comporta idéntico: su único grupo ES su fila.
  const schemes = distinctInvoiceTaxSchemes(invoice_taxes);
  // FACTURA MIXTA con desglose por línea (p. ej. envío con IVA y platos con
  // INC, `createFromOrder` con impuesto del envío): el esquema de cada línea
  // de la nota sale de las filas ligadas por `invoice_item_id` a SU gemela.
  // `null` = gemela exenta (sin filas y sin impuesto). Si alguna línea no se
  // resuelve sin ambigüedad, el carril no aplica y se exige `taxes` como hoy.
  const per_line_schemes =
    schemes.length > 1
      ? resolvePerLineNoteSchemes(items, related_items, invoice_taxes)
      : null;
  if (schemes.length !== 1 && !per_line_schemes) {
    const label = type === 'credit_note' ? 'nota crédito' : 'nota débito';
    const claimed = items.reduce(
      (acc, i) => acc.plus(new Prisma.Decimal(i.tax_amount || 0)),
      new Prisma.Decimal(0),
    );
    // N2 (round 2): factura sin impuestos + nota que no reclama ninguno ⇒
    // camino cero preservado (la regresión funcional: antes no lanzaba).
    // R3-01: la base también se escala por el divisor de la gemela — una
    // presentación en factura sin impuestos no vale 12× por omitir N3.
    if (schemes.length === 0 && claimed.equals(0)) {
      const zero_lines = items.map((item) => {
        const match = match_related(item);
        const divisor = divisor_for(item);
        const quantity = new Prisma.Decimal(item.quantity);
        const discount = new Prisma.Decimal(item.discount_amount || 0);
        const base = quantity
          .times(new Prisma.Decimal(item.unit_price))
          .dividedBy(divisor)
          .minus(discount);
        return {
          base_amount: base,
          tax_amount: new Prisma.Decimal(0),
          total_amount: base,
          is_inclusive: false,
          unit_price: backSolveUnitPrice(base, discount, divisor, quantity),
          unit_code: match?.unit_code ?? null,
          price_unit_quantity: divisor,
          stock_units_consumed: match?.stock_units_consumed ?? null,
        };
      });
      return {
        taxes: [],
        lines: zero_lines,
        totals: {
          subtotal: zero_lines.reduce(
            (acc, line) => acc.plus(line.base_amount),
            new Prisma.Decimal(0),
          ),
          discount: items.reduce(
            (acc, i) => acc.plus(new Prisma.Decimal(i.discount_amount || 0)),
            new Prisma.Decimal(0),
          ),
          tax: new Prisma.Decimal(0),
          total: zero_lines.reduce(
            (acc, line) => acc.plus(line.total_amount),
            new Prisma.Decimal(0),
          ),
        },
      };
    }
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_001,
      schemes.length === 0
        ? `Las líneas de la ${label} declaran ${claimed.toString()} de impuesto, pero la factura que corrigen no tiene ningún impuesto registrado del que derivarlo. Envía el desglose en «taxes».`
        : `La factura que corrige esta ${label} mezcla ${schemes.length} impuestos (${schemes.map((t) => t.tax_name).join(', ')}), y las líneas sólo traen el importe total. Envía el desglose en «taxes» indicando cuánto corresponde a cada uno.`,
      {
        note_tax_amount: claimed.toNumber(),
        invoice_tax_schemes: schemes.length,
      },
    );
  }

  type Scheme = (typeof invoice_taxes)[number];
  const scheme_params = (row: Scheme) => {
    const type = (row.tax_type ?? '').trim().toLowerCase() || 'iva';
    return {
      scheme_type: type,
      // Espejo de `resolveRateBasis` del motor y de `rateFractionPpm` del
      // preview: sin `rate_basis` explícito el ICA (y su retención) van POR MIL.
      rate_basis:
        type === 'ica' || type === 'reteica'
          ? ('per_mil' as const)
          : ('percent' as const),
      scheme_rate: Number(row.tax_rate),
    };
  };
  const scheme_of = (index: number): Scheme | null =>
    per_line_schemes ? per_line_schemes[index] : schemes[0];

  const lines: DerivedPartialNoteLine[] = items.map((item, index) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unit_price = new Prisma.Decimal(item.unit_price);
    const discount = new Prisma.Decimal(item.discount_amount || 0);
    const match = match_related(item);
    // N3 (round 2): la escala de catálogo va ANTES del despeje (F-037)
    // también en el carril de notas. Divisor compartido con N2 (`divisor_for`).
    const divisor = divisor_for(item);
    const gross = quantity.times(unit_price).dividedBy(divisor).minus(discount);

    // F-INC6 — campos a propagar tal cual desde la gemela en TODOS los
    // caminos de retorno de esta línea (exenta, N1, o kernel), y el helper
    // que reconstruye `unit_price` en forma BASE en cada uno.
    const twin_unit_code = match?.unit_code ?? null;
    const twin_stock_units_consumed = match?.stock_units_consumed ?? null;

    // Carril mixto: la gemela de esta línea es exenta ⇒ sin cuota.
    const line_scheme = scheme_of(index);
    if (line_scheme === null) {
      return {
        base_amount: gross,
        tax_amount: new Prisma.Decimal(0),
        total_amount: gross,
        is_inclusive: false,
        unit_price: backSolveUnitPrice(gross, discount, divisor, quantity),
        unit_code: twin_unit_code,
        price_unit_quantity: divisor,
        stock_units_consumed: twin_stock_units_consumed,
      };
    }
    const { scheme_type, rate_basis, scheme_rate } = scheme_params(line_scheme);

    // Herencia de inclusividad del motor: flag de línea ⇒ primer impuesto
    // del DTO ⇒ línea de la factura (misma pareja, o la única) ⇒ adicional.
    //
    // F-INC6 — el último eslabón YA NO hereda el flag a ciegas
    // (`match?.is_inclusive === true`). Una factura anterior a `8f8427f4b`
    // puede tener `is_inclusive=true` persistido junto a un `unit_price` YA
    // en forma base (el bug que esa fecha corrigió; el dato viejo queda
    // intacto). Heredar el flag re-despeja un impuesto que la factura
    // original nunca cobró encima de su `unit_price`. `twinIsGenuinelyInclusive`
    // reconoce la forma base igual que `judgeDraftLineSnapshot`
    // (`invoice-flow.service.ts`): si el bruto de la gemela ya coincide con
    // su `total - cuota` declarados, el `unit_price` YA es base pese al
    // flag, y la línea se trata como NO inclusiva.
    let is_inclusive: boolean | undefined;
    if (item.is_inclusive === true) is_inclusive = true;
    else if (item.is_inclusive === false) is_inclusive = false;
    else if (item.taxes?.[0]?.is_inclusive === true) is_inclusive = true;
    else if (item.taxes?.[0]?.is_inclusive === false) is_inclusive = false;
    if (is_inclusive === undefined) {
      is_inclusive = twinIsGenuinelyInclusive(match, divisor);
    }

    // N1 (round 2): línea exenta (su gemela de factura no tiene impuesto y
    // la nota no reclama ninguno, sin desglose explícito): el kernel NO
    // inventa cuota; se preserva el cero como antes del fix.
    const matched_tax_raw = (match as { tax_amount?: unknown } | undefined)
      ?.tax_amount;
    const matched_tax =
      matched_tax_raw == null ? NaN : Number(matched_tax_raw);
    const claimed_tax_early = Number(item.tax_amount || 0);
    if (
      match != null &&
      Number.isFinite(matched_tax) &&
      matched_tax === 0 &&
      claimed_tax_early === 0 &&
      !(item.taxes?.length)
    ) {
      return {
        base_amount: gross,
        tax_amount: new Prisma.Decimal(0),
        total_amount: gross,
        is_inclusive: false,
        unit_price: backSolveUnitPrice(gross, discount, divisor, quantity),
        unit_code: twin_unit_code,
        price_unit_quantity: divisor,
        stock_units_consumed: twin_stock_units_consumed,
      };
    }

    const kernel = absorbInclusiveLine({
      gross,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount ?? 0,
      price_unit_quantity: divisor,
      rates: [
        {
          rate: scheme_rate,
          rate_basis,
          tax_type: scheme_type,
          is_inclusive,
        },
      ],
    });

    if (kernel.invalid_inputs.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_006,
        `La línea ${index + 1}${item.description ? ` («${item.description}»)` : ''} de la nota trae una entrada inválida (${kernel.invalid_inputs.join(', ')}): corrige la línea en vez de emitirla en cero.`,
        {
          line_index: index,
          detail: kernel.invalid_inputs.join(', '),
          related_invoice_id,
        },
      );
    }
    if (!kernel.closed_exactly) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_005,
        `La línea ${index + 1}${item.description ? ` («${item.description}»)` : ''} con precio impuesto-incluido no puede cerrar al total de ${kernel.gross.toString()}: base más cuotas truncadas llega a ${kernel.closed_total.toString()}. Ajusta el precio o el descuento en 1 centavo y vuelve a intentarlo; re-guardar el mismo importe repite el mismo rechazo.`,
        {
          line_index: index,
          expected: kernel.gross.toString(),
          received: kernel.closed_total.toString(),
          difference: kernel.unclosed_residual_cents,
          related_invoice_id,
        },
      );
    }

    const kernel_quota = kernel.quotas[0]?.quota ?? new Prisma.Decimal(0);
    // La nota que acredita la línea ENTERA devuelve exactamente la cuota que
    // la factura declaró, no su re-despeje: una cuota truncada al vender
    // (envío gravado, precio con impuesto incluido) difiere hasta un centavo.
    const twin_quota = fullTwinQuota(
      item,
      related_items,
      single_related,
      is_inclusive,
      kernel_quota,
    );
    const quota = twin_quota ?? kernel_quota;
    const delta = quota.minus(kernel_quota);
    const claimed_tax = new Prisma.Decimal(item.tax_amount || 0);
    if (!claimed_tax.equals(quota)) {
      logger?.warn(
        `credit-note partial line ${index + 1} of invoice #${related_invoice_id}: ` +
          `client tax_amount=${claimed_tax.toString()} replaced by kernel quota=${quota.toString()} (server wins)`,
      );
    }
    const final_base = is_inclusive ? kernel.base.minus(delta) : kernel.base;
    return {
      // Inclusiva: el total queda (es el bruto) y la base absorbe el delta.
      // Adicional: la base queda y el total lo suma.
      base_amount: final_base,
      tax_amount: quota,
      total_amount: is_inclusive
        ? kernel.closed_total
        : kernel.closed_total.plus(delta),
      is_inclusive,
      // F-INC6 — `unit_price` back-solved de la base FINAL (post full-twin-
      // quota si aplicó): así la línea persistida es coherente con su propio
      // `tax_amount`/`total_amount`, nunca con un intermedio del kernel.
      unit_price: backSolveUnitPrice(final_base, discount, divisor, quantity),
      unit_code: twin_unit_code,
      price_unit_quantity: divisor,
      stock_units_consumed: twin_stock_units_consumed,
    };
  });

  const totals = lines.reduce(
    (acc, line, index) => ({
      subtotal: acc.subtotal.plus(line.base_amount),
      discount: acc.discount.plus(
        new Prisma.Decimal(items[index].discount_amount || 0),
      ),
      tax: acc.tax.plus(line.tax_amount),
      total: acc.total.plus(line.total_amount),
    }),
    {
      subtotal: new Prisma.Decimal(0),
      discount: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
      total: new Prisma.Decimal(0),
    },
  );

  if (totals.tax.isZero()) return { taxes: [], lines, totals };
  if (per_line_schemes) {
    // F-INC6 — UNA fila POR LÍNEA gravada (nunca agregada por tributo): el
    // schema de `invoice_taxes.invoice_item_id` documenta que un documento
    // con ≥2 tributos exige una fila por (línea × tributo), todas ligadas,
    // porque el emisor UBL arma el desglose POR LÍNEA leyendo ese vínculo —
    // agregar por tributo aquí dejaba la nota sin ese vínculo y el emisor
    // heredaba a TODA línea el primer tributo del documento. `line_index` es
    // la posición en `lines`/`items`; el llamador la traduce al
    // `invoice_item_id` recién creado en esa misma posición.
    return {
      taxes: lines
        .map((line, index) => {
          const line_scheme = per_line_schemes[index];
          if (line_scheme === null) return null;
          return {
            tax_rate_id: line_scheme.tax_rate_id ?? undefined,
            tax_name: line_scheme.tax_name,
            tax_rate: Number(line_scheme.tax_rate),
            taxable_amount: line.base_amount.toNumber(),
            tax_amount: line.tax_amount.toNumber(),
            tax_type: line_scheme.tax_type,
            line_index: index,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
      lines,
      totals,
    };
  }
  const scheme = schemes[0];
  return {
    taxes: [
      {
        tax_rate_id: scheme.tax_rate_id ?? undefined,
        tax_name: scheme.tax_name,
        tax_rate: Number(scheme.tax_rate),
        taxable_amount: totals.subtotal.toNumber(),
        tax_amount: totals.tax.toNumber(),
        tax_type: scheme.tax_type,
      },
    ],
    lines,
    totals,
  };
}

const FULL_TWIN_MAX_DELTA = new Prisma.Decimal('0.01');

const decimalOrNull = (value: unknown): Prisma.Decimal | null => {
  if (value == null) return null;
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value);
  } catch {
    return null;
  }
};

/**
 * F-INC6 — reconstruye `unit_price` en forma BASE, a la MISMA escala que el
 * `unit_price` de entrada (mismo divisor que la gemela):
 * `(base + descuento) × divisor / cantidad`. Para una línea NO inclusiva es
 * una identidad (no-op: `base = qty×unit_price/divisor - descuento` implica
 * el resultado es el `unit_price` de entrada sin cambios); para una
 * genuinamente inclusiva despoja el impuesto que el bruto de entrada llevaba
 * mezclado. `quantity` cero es defensivo (no debería ocurrir: la línea ya
 * pasó validación) — devuelve la base tal cual en vez de dividir por cero.
 */
function backSolveUnitPrice(
  base_amount: Prisma.Decimal,
  discount: Prisma.Decimal,
  divisor: number,
  quantity: Prisma.Decimal,
): Prisma.Decimal {
  if (quantity.isZero()) return base_amount;
  return base_amount.plus(discount).times(divisor).dividedBy(quantity);
}

/**
 * F-INC6 — decide si la INCLUSIVIDAD heredada de la gemela es genuina o un
 * artefacto histórico. Una factura anterior a `8f8427f4b` (2026-09-22) puede
 * tener `invoice_items.is_inclusive=true` persistido junto a un `unit_price`
 * YA en forma base — el bug que esa fecha corrigió, con el dato viejo
 * intacto. Heredar el flag a ciegas re-despeja un impuesto que la factura
 * original nunca cobró encima de su `unit_price`, duplicándolo en la nota.
 *
 * Reimplementación LOCAL y reducida del mismo criterio de
 * `judgeDraftLineSnapshot` (`invoice-flow.service.ts`, archivo fuera de
 * alcance): si el bruto de la gemela (misma escala, mismo divisor que esta
 * línea) ya coincide con su `total_amount - tax_amount` declarados, el
 * `unit_price` de la gemela YA es base pese al flag, y la línea se trata
 * como NO inclusiva. Sin `tax_amount`/`total_amount` con qué juzgar (fixtures
 * antiguos, o gemela sin esos campos) se confía en el flag como siempre —
 * `true` — para no introducir una regresión sobre el comportamiento previo.
 */
function twinIsGenuinelyInclusive(
  match:
    | {
        is_inclusive: boolean | null;
        unit_price?: Prisma.Decimal | number | null;
        quantity?: Prisma.Decimal | number | null;
        discount_amount?: Prisma.Decimal | number | null;
        tax_amount?: Prisma.Decimal | number | null;
        total_amount?: Prisma.Decimal | number | null;
      }
    | undefined,
  divisor: number,
): boolean {
  if (!match || match.is_inclusive !== true) return false;
  const declared_quota = decimalOrNull(match.tax_amount);
  const declared_total = decimalOrNull(match.total_amount);
  if (
    declared_quota === null ||
    declared_total === null ||
    !declared_quota.greaterThan(0)
  ) {
    return true;
  }
  const declared_base = declared_total.minus(declared_quota);
  const quantity = decimalOrNull(match.quantity) ?? new Prisma.Decimal(1);
  const unit_price = decimalOrNull(match.unit_price) ?? new Prisma.Decimal(0);
  const discount =
    decimalOrNull(match.discount_amount) ?? new Prisma.Decimal(0);
  const gross = quantity.times(unit_price).dividedBy(divisor).minus(discount);
  const round2 = (d: Prisma.Decimal) =>
    d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return !round2(gross).equals(round2(declared_base));
}

/**
 * Cuota persistida de la línea gemela cuando la nota la acredita COMPLETA:
 * misma pareja producto+variante (o la única línea), misma cantidad, mismo
 * precio unitario, mismo descuento y misma inclusividad. Sólo se hereda si
 * difiere del re-despeje en un centavo o menos —la holgura de un truncado
 * hecho al vender—; más que eso no es truncado y el kernel manda. `null` =
 * no aplica (nota parcial de la línea, o sin gemela exacta).
 */
function fullTwinQuota(
  item: {
    product_id?: number | null;
    product_variant_id?: number | null;
    quantity: number;
    unit_price: number;
    discount_amount?: number | null;
  },
  related_items: Array<{
    product_id: number | null;
    product_variant_id: number | null;
    is_inclusive: boolean | null;
    tax_amount?: Prisma.Decimal | number | null;
    quantity?: Prisma.Decimal | number | null;
    unit_price?: Prisma.Decimal | number | null;
    discount_amount?: Prisma.Decimal | number | null;
  }>,
  single_related: (typeof related_items)[number] | undefined,
  is_inclusive: boolean,
  kernel_quota: Prisma.Decimal,
): Prisma.Decimal | null {
  const quantity = new Prisma.Decimal(item.quantity);
  const unit_price = new Prisma.Decimal(item.unit_price);
  const discount = new Prisma.Decimal(item.discount_amount || 0);
  const candidates = single_related
    ? [single_related]
    : related_items.filter(
        (rel) =>
          (rel.product_id ?? null) === (item.product_id ?? null) &&
          (rel.product_variant_id ?? null) ===
            (item.product_variant_id ?? null),
      );
  const twin = candidates.find((rel) => {
    const rel_quantity = decimalOrNull(rel.quantity);
    const rel_price = decimalOrNull(rel.unit_price);
    return (
      rel_quantity !== null &&
      rel_price !== null &&
      rel_quantity.equals(quantity) &&
      rel_price.equals(unit_price) &&
      (decimalOrNull(rel.discount_amount) ?? new Prisma.Decimal(0)).equals(
        discount,
      ) &&
      (rel.is_inclusive === true) === is_inclusive &&
      decimalOrNull(rel.tax_amount) !== null
    );
  });
  if (!twin) return null;
  const persisted = decimalOrNull(twin.tax_amount) as Prisma.Decimal;
  const delta = persisted.minus(kernel_quota).abs();
  if (delta.isZero() || delta.greaterThan(FULL_TWIN_MAX_DELTA)) return null;
  return persisted;
}

/** Clave de tributo de `distinctInvoiceTaxSchemes` (untyped ⇒ iva, tarifa a 4 decimales). */
function schemeKey(row: {
  tax_type: string | null;
  tax_rate: Prisma.Decimal | number;
}): string {
  const type = (row.tax_type ?? '').trim().toLowerCase() || 'iva';
  return `${type}|${Number(row.tax_rate).toFixed(4)}`;
}

/**
 * Esquema de cada línea de una nota PARCIAL sobre una factura que mezcla
 * tributos, leído del desglose persistido (`invoice_taxes.invoice_item_id`)
 * de la línea gemela. Devuelve, por línea: la fila representante de su único
 * tributo, o `null` si la gemela es exenta (sin filas, sin impuesto, y la nota
 * no reclama cuota). Devuelve `null` para TODO si alguna línea no se resuelve
 * sin ambigüedad (sin gemela con id, gemelas con esquemas distintos, varias
 * filas de tributo en la misma línea): el llamador exige `taxes` como hoy.
 */
function resolvePerLineNoteSchemes<
  S extends {
    tax_type: string | null;
    tax_rate: Prisma.Decimal | number;
    invoice_item_id?: number | null;
  },
>(
  items: Array<{
    product_id?: number | null;
    product_variant_id?: number | null;
    tax_amount?: number | null;
    taxes?: unknown[] | null;
  }>,
  related_items: Array<{
    id?: number | null;
    product_id: number | null;
    product_variant_id: number | null;
    tax_amount?: Prisma.Decimal | number | null;
  }>,
  invoice_taxes: S[],
): Array<S | null> | null {
  if (!invoice_taxes.some((row) => row.invoice_item_id != null)) return null;
  const resolved: Array<S | null> = [];
  for (const item of items) {
    const twins =
      related_items.length === 1
        ? related_items
        : related_items.filter(
            (rel) =>
              (rel.product_id ?? null) === (item.product_id ?? null) &&
              (rel.product_variant_id ?? null) ===
                (item.product_variant_id ?? null),
          );
    if (twins.length === 0 || twins.some((twin) => twin.id == null)) {
      return null;
    }
    // Todas las gemelas candidatas deben declarar el MISMO tributo (o ser
    // todas exentas): elegir una sería inventar el esquema de la nota.
    const verdicts = twins.map((twin) => {
      const linked = invoice_taxes.filter(
        (row) =>
          row.invoice_item_id != null &&
          Number(row.invoice_item_id) === Number(twin.id),
      );
      const line_schemes = distinctInvoiceTaxSchemes(linked);
      if (line_schemes.length === 1) return line_schemes[0];
      if (line_schemes.length === 0 && Number(twin.tax_amount ?? NaN) === 0) {
        return null;
      }
      return undefined;
    });
    if (verdicts.some((verdict) => verdict === undefined)) return null;
    const keys = new Set(
      verdicts.map((verdict) => (verdict ? schemeKey(verdict) : 'exempt')),
    );
    if (keys.size !== 1) return null;
    const verdict = verdicts[0] as S | null;
    // Gemela exenta pero la nota reclama cuota ⇒ no hay de dónde derivarla.
    if (
      verdict === null &&
      (Number(item.tax_amount || 0) !== 0 || (item.taxes?.length ?? 0) > 0)
    ) {
      return null;
    }
    resolved.push(verdict);
  }
  return resolved;
}
