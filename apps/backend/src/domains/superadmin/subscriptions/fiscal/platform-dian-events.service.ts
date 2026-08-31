/**
 * PlatformDianEventsService — registro y listado de eventos RADIAN del riel
 * plataforma.
 *
 * ## Por qué servicio paralelo y no delegación a DianEventsService tienda
 *
 * `DianEventsService` usa `StorePrismaService.invoices.findFirst` que el
 * scoping extension decora con `store_id` del contexto JWT. Para
 * plataforma, sintetizar `store_id: undefined` haría que Prisma OMITA el
 * filtro (mismo problema IDOR que C.3 con el delivery). Mismo argumento
 * que `PlatformDeliveryService` y `PlatformCreditNotesService`.
 *
 * Slice C.4 mínimo viable:
 * - valida el código del evento contra el mismo catálogo del riel tienda
 *   (`SUPPORTED_EVENT_CODES` del módulo tienda, mismo import)
 * - valida que la factura existe y pertenece a la organización plataforma
 * - valida status='accepted' y CUFE presente (mismo invariante que el
 *   servicio tienda: un evento RADIAN referencia el documento por CUFE)
 * - valida unicidad: no se registra un evento del mismo código ya aceptado
 *   para la misma factura (DIAN_EVENT_003)
 * - persiste la fila en `dian_document_events` con `status='pending'`
 *   (la pieza de transmisión SOAP al proveedor DIAN es C.4.5 — siguiente
 *   slice, mismo patrón que la nota del delivery C.3.5)
 *
 * El armado del UBL `ApplicationResponse` y la llamada al provider SOAP
 * viven en el riel tienda (`services/dian-events.service.ts:300+`); el
 * plan lo cubre el slice C.4.5 — verificable por live curl cuando la DB
 * vuelva.
 */
import { Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

import { RegisterDianEventDto } from '../../../store/invoicing/dto/register-dian-event.dto';
import { assertSupportedEventCode } from '../../../store/invoicing/services/dian-events.service';
import { DianDirectProvider } from '../../../store/invoicing/providers/dian-direct/dian-direct.provider';
import { onlyDigits } from '../../../../common/utils/nit.util';
import { DIAN_ID_TYPES } from '../../../store/invoicing/providers/dian-direct/constants/dian-document-types';
import {
  DIAN_EVENT_CODES,
  DIAN_EVENT_OPERATION_CODES,
  DIAN_EVENT_OPERATION_LABELS,
  DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS,
  DIAN_ENDORSEMENT_EVENT_CODES,
  DIAN_ENDORSEMENT_LIST_IDS,
  DIAN_EVENT_LABELS,
  DianEventCode,
} from '../../../store/invoicing/providers/dian-direct/constants/dian-endpoints';
import {
  DianEventDetails,
  DianEventParty,
} from '../../../store/invoicing/providers/dian-direct/xml/ubl-application-response.builder';

/** Event statuses persisted in `dian_document_events.status`. */
export const DIAN_EVENT_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ERROR: 'error',
} as const;

/**
 * Codes generated from OUR side of the referenced document (the tenant is the
 * emisor), as opposed to the ones a buyer performs. Mirrors the constant in
 * `DianEventsService` (services/dian-events.service.ts:45).
 */
const CUSTOMER_GENERATED_EVENTS: readonly string[] = [
  DIAN_EVENT_CODES.ACKNOWLEDGEMENT,
  DIAN_EVENT_CODES.CLAIM,
  DIAN_EVENT_CODES.GOODS_RECEIVED,
  DIAN_EVENT_CODES.EXPRESS_ACCEPTANCE,
  DIAN_EVENT_CODES.ECONOMIC_RIGHTS_TRANSFER_PAYMENT,
];

@Injectable()
export class PlatformDianEventsService {
  private readonly logger = new Logger(PlatformDianEventsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
    private readonly dianProvider: DianDirectProvider,
  ) {}

  /**
   * Registra un evento RADIAN contra una factura plataforma y lo transmite
   * al proveedor DIAN via SOAP (SendEventUpdateStatus), actualizando la
   * fila de `pending` a `accepted`/`rejected`/`error`.
   *
   * Flujo espejo de `DianEventsService.register()` del riel tienda:
   *  1. valida código (mismo catálogo), operation_code y details ANTES de
   *     tocar la DB (mismo ERR-05/ERR-02 que tienda)
   *  2. carga factura con `withoutScope()` + `organization_id` plataforma
   *     (mismo invariante IDOR que C.3/C.4)
   *  3. valida status='accepted' con CUFE y unicidad DIAN_EVENT_003
   *  4. reutiliza una fila previa pendiente/rejected del mismo código para
   *     conservar el consecutivo (mismo patrón que tienda: reuse existing_attempt)
   *  5. persiste `pending` ANTES de transmitir (evidencia no se pierde si DIAN cae)
   *  6. sintetiza `RequestContext` plataforma (`organization_id` + `store_id: undefined`)
   *     para que `DianDirectProvider.loadConfig()` resuelva la entidad fiscal
   *     consolidada (mismo camino que `PlatformCreditNotesService` con
   *     `RequestContextService.run()`)
   *  7. llama `DianDirectProvider.sendDocumentEvent()` (mismo builder UBL
   *     `ApplicationResponse`, misma CUDE con software PIN, mismo SOAP
   *     `SendEventUpdateStatus`)
   *  8. actualiza la fila con `dian_status_code`, `response_xml`, `cude`,
   *     `issued_at` y `status=accepted/rejected/error`
   */
  async registerEvent(
    invoice_id: number,
    input: RegisterDianEventDto,
  ): Promise<{ id: number; status: string; cude?: string | null }> {
    // 1. Validar código contra el catálogo compartido del riel tienda.
    const event_code = assertSupportedEventCode(input.event_code);

    // 1b. Validar operation_code y details ANTES de tocar la DB — mismo orden
    //     que `DianEventsService.register()` (líneas 137-141): un input inválido
    //     no debe dejar rastro ni gastar consecutivo.
    const operation_code = this.assertOperationCode(event_code, input.operation_code);
    const details = this.buildEventDetails(event_code, input);

    // 2. Resolver ámbito plataforma.
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;

    // 3. Cargar factura (sin scoping para evitar IDOR cross-tenant). Se
    //    traen los mismos campos que `DianEventsService.loadInvoiceOrThrow()`
    //    para poder armar `DianEventParty` y `referenced_document_date`.
    const invoice = await this.prisma.withoutScope().invoices.findFirst({
      where: { id: invoice_id, organization_id: platformOrgId },
      select: {
        id: true,
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
        `La factura ${invoice_id} no pertenece a la organización plataforma ${platformOrgId}.`,
        { invoice_id, platform_organization_id: platformOrgId },
      );
    }

    // 4. Validar status='accepted' con CUFE — el evento referencia el doc
    //    por CUFE en el catálogo DIAN; sin factura aceptada la referencia
    //    no existe y DIAN rechaza con error oscuro.
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

    // 5. Validar unicidad: un evento ya aceptado para el mismo código
    //    no se vuelve a registrar (mismo invariante que el riel tienda).
    const already = await this.prisma
      .withoutScope()
      .dian_document_events.findFirst({
        where: {
          invoice_id,
          event_code,
          status: 'accepted',
        },
        select: { id: true, cude: true },
      });
    if (already) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_003,
        `El evento ${event_code} ya fue aceptado para esta factura (cude=${already.cude}).`,
        { invoice_id, event_code, cude: already.cude },
      );
    }

    // 6. Reutilizar una fila previa del mismo código (pending/rejected/error)
    //    para que el consecutivo y la CUDE se mantengan estables entre reintentos
    //    — mismo patrón que `DianEventsService.register()` línea 194+.
    const existing_attempt = await this.prisma
      .withoutScope()
      .dian_document_events.findFirst({
        where: { invoice_id, event_code },
        orderBy: { id: 'asc' },
        select: { id: true },
      });

    const event_row =
      existing_attempt ??
      (await this.prisma.withoutScope().dian_document_events.create({
        data: {
          organization_id: platformOrgId,
          store_id: null,
          invoice_id,
          dian_configuration_id: null,
          event_code,
          referenced_cufe: invoice.cufe,
          status: 'pending',
        },
        select: { id: true, status: true },
      }));

    const event_number = String(event_row.id);
    const issue_date = this.dateOnly(new Date());
    const referenced_date = this.dateOnly(invoice.issue_date as Date);

    this.logger.log(
      `Platform RADIAN event ${existing_attempt ? 'retry' : 'queued'}: invoice=${invoice.invoice_number} code=${event_code} id=${event_row.id} event_number=${event_number}`,
    );

    // 7. Transmitir via SOAP. Se sintetiza el RequestContext plataforma para
    //    que `DianDirectProvider.loadConfig()` resuelva la entidad fiscal
    //    consolidada (ORGANIZATION scope, store_id NULL) — mismo truco que
    //    `PlatformCreditNotesService` con `RequestContextService.run()`.
    let providerResult: Awaited<ReturnType<DianDirectProvider['sendDocumentEvent']>> | null =
      null;
    let transmitError: unknown = null;

    try {
      providerResult = await RequestContextService.run(
        {
          user_id: 0,
          organization_id: platformOrgId,
          store_id: undefined,
          is_super_admin: true,
          is_owner: false,
          app_type: 'VENDIX_ADMIN',
          roles: ['SUPER_ADMIN'],
          permissions: ['superadmin:fiscal:invoicing'],
          request_id: `platform-dian-event-${invoice_id}-${event_code}-${Date.now()}`,
        },
        () =>
          this.dianProvider.sendDocumentEvent({
            event_code,
            operation_code,
            details,
            event_number,
            generated_by: CUSTOMER_GENERATED_EVENTS.includes(event_code)
              ? 'customer'
              : 'issuer',
            referenced_document_number: invoice.invoice_number,
            referenced_document_key: invoice.cufe as string,
            referenced_document_date: referenced_date,
            customer: this.buildCustomerParty(invoice),
            issue_date,
            description: (input as any).description,
          }),
      );
    } catch (error) {
      transmitError = error;
      this.logger.error(
        `Platform RADIAN event transmit failed before SOAP (invoice=${invoice.invoice_number} code=${event_code} id=${event_row.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Si el provider lanzó fuera de su try interno (ej. loadConfig sin config
    // activa), no hay result: se persiste como error con el mensaje.
    if (transmitError && !providerResult) {
      const message =
        transmitError instanceof Error ? transmitError.message : String(transmitError);
      // Si es un VendixHttpException con errorCode conocido (ej. DIAN_EVENT_005
      // ya validado arriba no debería llegar aquí, pero DIAN_EVENT_004 sí podría
      // si el resolver se usara), lo re-lanzamos después de persistir error.
      const isVendixError =
        transmitError instanceof VendixHttpException &&
        (transmitError as any).errorCode?.code === ErrorCodes.DIAN_EVENT_004?.code;

      const persistedError = await this.prisma
        .withoutScope()
        .dian_document_events.update({
          where: { id: event_row.id },
          data: {
            event_number,
            cude: null,
            referenced_cufe: invoice.cufe,
            status: DIAN_EVENT_STATUS.ERROR,
            dian_status_code: null,
            dian_status_message: message,
            request_xml: null,
            response_xml: null,
            issued_at: null,
            updated_at: new Date(),
          },
          select: { id: true, status: true, cude: true },
        });

      if (isVendixError) {
        throw transmitError;
      }

      this.logger.log(
        `Platform RADIAN event ${event_code} for invoice #${invoice_id} (${invoice.invoice_number}): error (id=${event_row.id}) ${message}`,
      );

      return persistedError as { id: number; status: string; cude: string | null };
    }

    // 8. Mapear resultado del provider a estado persistido — mismo criterio que
    //    `DianEventsService.register()` líneas 234-238: success → accepted,
    //    con errores → rejected, sin errores pero no success → error.
    const result = providerResult!;
    const status = result.success
      ? DIAN_EVENT_STATUS.ACCEPTED
      : result.errors.length > 0
        ? DIAN_EVENT_STATUS.REJECTED
        : DIAN_EVENT_STATUS.ERROR;

    const persisted = await this.prisma.withoutScope().dian_document_events.update({
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
      select: { id: true, status: true, cude: true, event_number: true },
    });

    this.logger.log(
      `Platform RADIAN event ${event_code} for invoice #${invoice_id} (${invoice.invoice_number}): ${status} (CUDE ${result.cude} id=${event_row.id})`,
    );

    return persisted as { id: number; status: string; cude: string | null };
  }

  /**
   * Lista los eventos RADIAN de una factura plataforma, ordenados por id
   * descendente (más nuevo primero — mismo orden que el riel tienda).
   */
  async listEvents(invoice_id: number): Promise<unknown[]> {
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;

    const invoice = await this.prisma.withoutScope().invoices.findFirst({
      where: { id: invoice_id, organization_id: platformOrgId },
      select: { id: true },
    });
    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `La factura ${invoice_id} no pertenece a la organización plataforma ${platformOrgId}.`,
        { invoice_id, platform_organization_id: platformOrgId },
      );
    }

    return this.prisma.withoutScope().dian_document_events.findMany({
      where: { invoice_id },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        event_code: true,
        event_number: true,
        cude: true,
        referenced_cufe: true,
        status: true,
        dian_status_code: true,
        dian_status_message: true,
        issued_at: true,
        created_at: true,
      },
    });
  }

  // ─── Private Helpers — espejo de DianEventsService (services/dian-events.service.ts) ─

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
        `El evento ${event_code} (${DIAN_EVENT_LABELS[event_code] ?? event_code}) exige indicar el tipo de operación. Opciones: ${options}.`,
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

  private buildEventDetails(
    event_code: DianEventCode,
    input: RegisterDianEventDto,
  ): DianEventDetails | undefined {
    const required = DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS[event_code] ?? [];
    const provided = (input as any).negotiation_info ?? {};

    const missing = required.filter(
      (field) =>
        provided[field] === undefined ||
        provided[field] === null ||
        String(provided[field]).trim() === '',
    );
    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_EVENT_005,
        `El evento ${event_code} (${DIAN_EVENT_LABELS[event_code] ?? event_code}) exige los datos de negociación: ${missing.join(', ')}.`,
        { event_code, missing, required },
      );
    }

    if (DIAN_ENDORSEMENT_EVENT_CODES.includes(event_code)) {
      const list_ids = Object.values(DIAN_ENDORSEMENT_LIST_IDS) as string[];
      if (
        !(input as any).endorsement_list_id ||
        !list_ids.includes((input as any).endorsement_list_id)
      ) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_EVENT_005,
          `El evento ${event_code} exige indicar si el endoso es completo ('${DIAN_ENDORSEMENT_LIST_IDS.COMPLETE}') o en blanco ('${DIAN_ENDORSEMENT_LIST_IDS.BLANK}').`,
          {
            event_code,
            endorsement_list_id: (input as any).endorsement_list_id,
            allowed: list_ids,
          },
        );
      }

      if (
        (input as any).endorsement_list_id === DIAN_ENDORSEMENT_LIST_IDS.COMPLETE &&
        !(input as any).issuer_party
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
      issuer_party: (input as any).issuer_party,
      endorsement_list_id: DIAN_ENDORSEMENT_EVENT_CODES.includes(event_code)
        ? (input as any).endorsement_list_id
        : undefined,
      negotiation_info: negotiation_info.length ? negotiation_info : undefined,
      validity_start_date: (input as any).validity_start_date,
      validity_end_date: (input as any).validity_end_date,
    };

    const has_content = Object.values(details).some((value) => value !== undefined);
    return has_content ? details : undefined;
  }

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
      '222222222222';

    return {
      document_type:
        invoice.supplier?.document_type ||
        (document_number === '222222222222' ? DIAN_ID_TYPES.CC : DIAN_ID_TYPES.NIT),
      document_number,
      document_dv: invoice.supplier?.verification_digit ?? undefined,
      legal_name: invoice.supplier?.name || invoice.customer_name || 'Consumidor final',
    };
  }

  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
