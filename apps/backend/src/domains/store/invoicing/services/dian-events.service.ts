import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { InvoiceProviderResolver } from '../providers/invoice-provider-resolver.service';
import { DianDirectProvider } from '../providers/dian-direct/dian-direct.provider';
import {
  DIAN_ENDORSEMENT_EVENT_CODES,
  DIAN_ENDORSEMENT_LIST_IDS,
  DIAN_EVENT_CODES,
  DIAN_EVENT_LABELS,
  DIAN_EVENT_OPERATION_CODES,
  DIAN_EVENT_OPERATION_LABELS,
  DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS,
  DianEventCode,
} from '../providers/dian-direct/constants/dian-endpoints';
import { DIAN_ID_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import {
  DianEventDetails,
  DianEventParty,
} from '../providers/dian-direct/xml/ubl-application-response.builder';
import { onlyDigits } from '../../../../common/utils/nit.util';

/** Event statuses persisted in `dian_document_events.status`. */
export const DIAN_EVENT_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ERROR: 'error',
} as const;

/**
 * Codes generated from OUR side of the referenced document (the tenant is the
 * emisor), as opposed to the ones a buyer performs.
 *
 * From the reception family only 034 (aceptación tácita) belongs here: it is the
 * emisor who counts the 3 business days and declares the silence, whereas
 * 030/031/032/033 are acts of the buyer. The whole negotiable-instrument family
 * belongs here too — per numeral 14.2.1 its responsables (emisor, tenedor
 * legítimo, avalista, autoridad competente) all act on the holder's side — EXCEPT
 * 051, whose responsable is the "adquiriente/deudor/aceptante".
 *
 * Getting this backwards inverts SenderParty/ReceiverParty and RADIAN rejects the
 * event as coming from an unauthorized party.
 */
const CUSTOMER_GENERATED_EVENTS: readonly string[] = [
  DIAN_EVENT_CODES.ACKNOWLEDGEMENT,
  DIAN_EVENT_CODES.CLAIM,
  DIAN_EVENT_CODES.GOODS_RECEIVED,
  DIAN_EVENT_CODES.EXPRESS_ACCEPTANCE,
  DIAN_EVENT_CODES.ECONOMIC_RIGHTS_TRANSFER_PAYMENT,
];

export const SUPPORTED_EVENT_CODES: readonly string[] = Object.values(
  DIAN_EVENT_CODES,
);

/**
 * Valida y normaliza el código de evento RADIAN contra el catálogo
 * compartido. Exportada para que `PlatformDianEventsService` (C.4 del
 * CP-platform-invoicing-parity) use el mismo gate de ERR-08 sin
 * duplicar la lista de códigos ni el mensaje.
 */
export function assertSupportedEventCode(
  event_code: string,
): DianEventCode {
  const normalized = String(event_code ?? '').trim();
  if (!SUPPORTED_EVENT_CODES.includes(normalized)) {
    throw new VendixHttpException(
      ErrorCodes.DIAN_EVENT_002,
      `Código de evento RADIAN no soportado: '${normalized}'. Soportados: ${SUPPORTED_EVENT_CODES.join(', ')}.`,
      { event_code: normalized, supported: SUPPORTED_EVENT_CODES },
    );
  }
  return normalized as DianEventCode;
}

export interface RegisterDianEventInput {
  event_code: string;
  /** Justification. RADIAN expects one on a reclamo (031). */
  description?: string;
  /**
   * "Tipo de operación" (numeral 14.1.2). Mandatory when the event has more than
   * one; see `assertOperationCode`.
   */
  operation_code?: string;
  /** Endorsee / direct buyer / competent officer, per event. */
  issuer_party?: DianEventParty;
  /** '1' endoso completo · '2' endoso en blanco (numeral 14.2.3). */
  endorsement_list_id?: string;
  /**
   * `InformacionNegociacion` values keyed by the annex literals — e.g.
   * `{ ValorTotalEndoso: '1500000.00', TasaDescuento: '0.05' }`.
   */
  negotiation_info?: Record<string, string>;
  /** Mandate validity. Both absent = mandato ilimitado. */
  validity_start_date?: string;
  validity_end_date?: string;
}

/**
 * Registers RADIAN document events (Res. 000085/2022) against invoices already
 * accepted by DIAN.
 *
 * WHY THIS IS A SEPARATE SERVICE FROM `InvoiceFlowService`: an event does not move
 * the invoice's own state machine. The invoice stays `accepted`; what changes is
 * the RADIAN track that turns the invoice into a negotiable instrument. Mixing the
 * two would let an event failure look like an invoice failure and — worse — let a
 * retry re-run the invoice transmission.
 *
 * The row is created BEFORE transmitting, and its `id` becomes the event
 * consecutive (`cbc:ID`). That ordering is deliberate: a retry of a failed event
 * reuses the same consecutive instead of burning a new one, and the CUDE stays
 * reproducible because it is derived from that same consecutive.
 */
@Injectable()
export class DianEventsService {
  private readonly logger = new Logger(DianEventsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly resolver: InvoiceProviderResolver,
  ) {}

  /** Events already registered for an invoice, newest first. */
  async findByInvoice(invoice_id: number) {
    await this.loadInvoiceOrThrow(invoice_id);
    return this.prisma.dian_document_events.findMany({
      where: { invoice_id },
      orderBy: { id: 'desc' },
    });
  }

  async register(invoice_id: number, input: RegisterDianEventInput) {
    const event_code = this.assertSupportedCode(input.event_code);
    // Both validations run BEFORE any row is written and before the consecutive is
    // spent: a rejected input must leave no trace.
    const operation_code = this.assertOperationCode(
      event_code,
      input.operation_code,
    );
    const details = this.buildEventDetails(event_code, input);
    const invoice = await this.loadInvoiceOrThrow(invoice_id);

    // An event references the document by CUFE inside the DIAN catalogue. Without
    // an accepted document that key does not exist there, so the event would be
    // rejected with a reference error that is much harder to read than this one.
    if (invoice.status !== 'accepted' || !invoice.cufe) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_001,
        `La factura ${invoice.invoice_number} no está aceptada por la DIAN o no tiene CUFE; no se puede registrar el evento ${event_code}.`,
        {
          invoice_id,
          invoice_status: invoice.status,
          has_cufe: Boolean(invoice.cufe),
          event_code,
        },
      );
    }

    const already_accepted = await this.prisma.dian_document_events.findFirst({
      where: {
        invoice_id,
        event_code,
        status: DIAN_EVENT_STATUS.ACCEPTED,
      },
      select: { id: true, cude: true },
    });
    if (already_accepted) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_003,
        `El evento ${event_code} (${
          DIAN_EVENT_LABELS[event_code] ?? event_code
        }) ya fue aceptado para la factura ${invoice.invoice_number}.`,
        {
          invoice_id,
          event_code,
          existing_event_id: already_accepted.id,
          existing_cude: already_accepted.cude,
        },
      );
    }

    const provider = await this.resolver.resolve();
    if (!(provider instanceof DianDirectProvider)) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_004,
        'Los eventos RADIAN requieren la integración directa con la DIAN (software propio) activa para esta tienda.',
        { invoice_id, event_code },
      );
    }

    // Reuse a previously failed row for the same code so the consecutive and the
    // CUDE stay stable across retries.
    const existing_attempt = await this.prisma.dian_document_events.findFirst({
      where: { invoice_id, event_code },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const event_row =
      existing_attempt ??
      (await this.prisma.dian_document_events.create({
        data: {
          organization_id: invoice.organization_id,
          store_id: invoice.store_id,
          invoice_id,
          event_code,
          referenced_cufe: invoice.cufe,
          status: DIAN_EVENT_STATUS.PENDING,
        },
        select: { id: true },
      }));

    const event_number = String(event_row.id);
    const issue_date = this.dateOnly(new Date());
    const referenced_date = this.dateOnly(invoice.issue_date);

    const result = await provider.sendDocumentEvent({
      event_code,
      operation_code,
      details,
      event_number,
      generated_by: CUSTOMER_GENERATED_EVENTS.includes(event_code)
        ? 'customer'
        : 'issuer',
      referenced_document_number: invoice.invoice_number,
      referenced_document_key: invoice.cufe,
      referenced_document_date: referenced_date,
      customer: this.buildCustomerParty(invoice),
      issue_date,
      description: input.description,
    });

    const status = result.success
      ? DIAN_EVENT_STATUS.ACCEPTED
      : result.errors.length > 0
        ? DIAN_EVENT_STATUS.REJECTED
        : DIAN_EVENT_STATUS.ERROR;

    const persisted = await this.prisma.dian_document_events.update({
      where: { id: event_row.id },
      data: {
        dian_configuration_id: result.dian_configuration_id,
        event_number,
        cude: result.cude,
        referenced_cufe: invoice.cufe,
        status,
        dian_status_code: result.status_code ?? null,
        dian_status_message: result.message ?? null,
        request_xml: result.request_xml,
        response_xml: result.response_xml ?? null,
        issued_at: result.success ? new Date() : null,
        updated_at: new Date(),
      },
    });

    this.logger.log(
      `RADIAN event ${event_code} for invoice #${invoice_id} (${invoice.invoice_number}): ${status} (CUDE ${result.cude})`,
    );

    return persisted;
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Resolves the "tipo de operación" that lands in `cbc:CustomizationID`.
   *
   * When the event has exactly ONE operation type the annex reuses the event code,
   * so it is inferred. When it has several — an endorsement with or without the
   * endorser's liability, a partial or total payment — the choice is a legal one
   * that only the caller can make, and guessing it would register the wrong act.
   * So it is demanded, with the valid options and their meanings in the error.
   */
  private assertOperationCode(
    event_code: DianEventCode,
    operation_code?: string,
  ): string {
    const allowed = DIAN_EVENT_OPERATION_CODES[event_code] ?? [event_code];

    if (allowed.length === 1) {
      const only = allowed[0];
      if (operation_code && operation_code !== only) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_EVENT_005,
          `El evento ${event_code} solo admite el tipo de operación '${only}'; se recibió '${operation_code}'.`,
          { event_code, operation_code, allowed },
        );
      }
      return only;
    }

    if (!operation_code) {
      const options = allowed
        .map((code) => `${code} = ${DIAN_EVENT_OPERATION_LABELS[code] ?? code}`)
        .join(' · ');
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_005,
        `El evento ${event_code} (${
          DIAN_EVENT_LABELS[event_code] ?? event_code
        }) exige indicar el tipo de operación. Opciones: ${options}.`,
        { event_code, allowed },
      );
    }

    if (!allowed.includes(operation_code)) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_005,
        `Tipo de operación '${operation_code}' no válido para el evento ${event_code}. Válidos: ${allowed.join(', ')}.`,
        { event_code, operation_code, allowed },
      );
    }

    return operation_code;
  }

  /**
   * Builds the event's extra blocks and refuses to transmit an incomplete one.
   *
   * This guard is the point of the whole method. An event missing a legally
   * required value is not a soft failure: RADIAN rejects it, and the rejection is
   * reported against the event consecutive we already spent. Failing here with the
   * missing field NAMED costs nothing and is recoverable; failing at the DIAN
   * costs a round trip and an unreadable error.
   */
  private buildEventDetails(
    event_code: DianEventCode,
    input: RegisterDianEventInput,
  ): DianEventDetails | undefined {
    const required = DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS[event_code] ?? [];
    const provided = input.negotiation_info ?? {};

    const missing = required.filter(
      (field) =>
        provided[field] === undefined ||
        provided[field] === null ||
        String(provided[field]).trim() === '',
    );
    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_005,
        `El evento ${event_code} (${
          DIAN_EVENT_LABELS[event_code] ?? event_code
        }) exige los datos de negociación: ${missing.join(', ')}.`,
        { event_code, missing, required },
      );
    }

    if (DIAN_ENDORSEMENT_EVENT_CODES.includes(event_code)) {
      const list_ids = Object.values(DIAN_ENDORSEMENT_LIST_IDS) as string[];
      if (
        !input.endorsement_list_id ||
        !list_ids.includes(input.endorsement_list_id)
      ) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_EVENT_005,
          `El evento ${event_code} exige indicar si el endoso es completo ('${DIAN_ENDORSEMENT_LIST_IDS.COMPLETE}') o en blanco ('${DIAN_ENDORSEMENT_LIST_IDS.BLANK}').`,
          {
            event_code,
            endorsement_list_id: input.endorsement_list_id,
            allowed: list_ids,
          },
        );
      }

      // Art. 654 C.Co.: a COMPLETE endorsement must name the endorsee. A BLANK one
      // carries only the endorser's signature, so demanding the party there would
      // block a form of endorsement the code expressly allows.
      if (
        input.endorsement_list_id === DIAN_ENDORSEMENT_LIST_IDS.COMPLETE &&
        !input.issuer_party
      ) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_EVENT_005,
          `Un endoso completo (evento ${event_code}) exige los datos del endosatario.`,
          { event_code },
        );
      }
    }

    const negotiation_info = Object.entries(provided)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => ({ name, value: String(value) }));

    const details: DianEventDetails = {
      issuer_party: input.issuer_party,
      endorsement_list_id: DIAN_ENDORSEMENT_EVENT_CODES.includes(event_code)
        ? input.endorsement_list_id
        : undefined,
      negotiation_info: negotiation_info.length ? negotiation_info : undefined,
      validity_start_date: input.validity_start_date,
      validity_end_date: input.validity_end_date,
    };

    const has_content = Object.values(details).some(
      (value) => value !== undefined,
    );
    return has_content ? details : undefined;
  }

  private assertSupportedCode(event_code: string): DianEventCode {
    return assertSupportedEventCode(event_code);
  }

  private async loadInvoiceOrThrow(invoice_id: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        invoice_number: true,
        status: true,
        cufe: true,
        issue_date: true,
        customer_name: true,
        customer_tax_id: true,
        supplier: {
          select: {
            name: true,
            tax_id: true,
            document_type: true,
            verification_digit: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `Factura #${invoice_id} no encontrada.`,
        { invoice_id },
      );
    }

    return invoice;
  }

  /**
   * The adquiriente as RADIAN needs it. `supplier` wins over the denormalized
   * `customer_*` columns because it carries the DIAN document type and the DV;
   * the columns are the fallback for invoices issued to a walk-in customer.
   */
  private buildCustomerParty(invoice: {
    customer_name: string | null;
    customer_tax_id: string | null;
    supplier: {
      name: string;
      tax_id: string | null;
      document_type: string | null;
      verification_digit: string | null;
    } | null;
  }): DianEventParty {
    const document_number =
      onlyDigits(invoice.supplier?.tax_id ?? invoice.customer_tax_id ?? '') ||
      // Consumidor final: the DIAN placeholder identification.
      '222222222222';

    return {
      document_type:
        invoice.supplier?.document_type ||
        (document_number === '222222222222'
          ? DIAN_ID_TYPES.CC
          : DIAN_ID_TYPES.NIT),
      document_number,
      document_dv: invoice.supplier?.verification_digit ?? undefined,
      legal_name:
        invoice.supplier?.name ||
        invoice.customer_name ||
        'Consumidor final',
    };
  }

  /** `YYYY-MM-DD` without touching the instant's timezone semantics. */
  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
