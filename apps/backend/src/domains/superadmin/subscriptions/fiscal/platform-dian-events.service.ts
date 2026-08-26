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

import { RegisterDianEventDto } from '../../../store/invoicing/dto/register-dian-event.dto';
import { assertSupportedEventCode } from '../../../store/invoicing/services/dian-events.service';

@Injectable()
export class PlatformDianEventsService {
  private readonly logger = new Logger(PlatformDianEventsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  /**
   * Registra un evento RADIAN contra una factura plataforma.
   * Devuelve la fila persistida con `status='pending'` hasta que C.4.5
   * la transmita (slice posterior que reutiliza el SOAP provider del
   * riel tienda).
   */
  async registerEvent(
    invoice_id: number,
    input: RegisterDianEventDto,
  ): Promise<{ id: number; status: string }> {
    // 1. Validar código contra el catálogo compartido del riel tienda.
    //    Misma función, mismo ERR-08 (EVENT_INVALID_CODE), mismo mensaje.
    const event_code = assertSupportedEventCode(input.event_code);

    // 2. Resolver ámbito plataforma.
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;

    // 3. Cargar factura (sin scoping para evitar IDOR cross-tenant).
    const invoice = await this.prisma.withoutScope().invoices.findFirst({
      where: { id: invoice_id, organization_id: platformOrgId },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        cufe: true,
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

    // 6. Persistir fila pendiente. La pieza C.4.5 transmite via SOAP y
    //    actualiza status a 'accepted'/'rejected'/'error'. Mismo patrón
    //    que `register()` del riel tienda (línea 165+): persiste ANTES de
    //    transmitir para que un fallo de transmisión no borre la
    //    evidencia de que se intentó.
    //    dian_configuration_id queda NULL aquí: el contexto plataforma
    //    no lo expone todavía (PlatformOrgContext es 4 campos). La pieza
    //    C.4.5 puede resolverlo via platform_settings.dian_configuration_id
    //    cuando extienda el contexto.
    const created = await this.prisma.withoutScope().dian_document_events.create({
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
    });

    this.logger.log(
      `Platform RADIAN event queued: invoice=${invoice.invoice_number} code=${event_code} id=${created.id}`,
    );

    return created;
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
}
