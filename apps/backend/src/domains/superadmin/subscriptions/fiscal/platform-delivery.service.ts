/**
 * PlatformDeliveryService — reenvío por correo de facturas del riel plataforma.
 *
 * ## Por qué servicio paralelo y no delegación a InvoiceDeliveryService tienda
 *
 * El servicio tienda vive en `domains/store/invoicing/delivery/` y depende de
 * `StorePrismaService.invoices.findFirst()` que el scoping extension decora con
 * `store_id` del contexto JWT. Para plataforma, la organización NO tiene
 * store — emitir contra el servicio tienda con un contexto sintetizado
 * `store_id: undefined` haría que Prisma OMITA el filtro de tienda
 * (`undefined` = "skip this filter" en cláusulas where), exponiendo todas las
 * facturas de la organización plataforma. IDOR unacceptable para multi-tenant.
 *
 * Mismo argumento que `PlatformCreditNotesService` (C.2): servicio paralelo
 * con `GlobalPrismaService.withoutScope()` y filtros `organization_id`
 * explícitos. Validación de pertenencia (related invoice = org plataforma) +
 * validación de email (IsEmail) + reutilización del writer compartido
 * (`writeInvoiceDeliveryEvent`).
 *
 * ## Lo que NO hace este slice
 *
 * - NO arma el ZIP + PDF + XML para el correo: eso es trabajo de
 *   `InvoiceDeliveryService` (500+ líneas con la lógica del Anexo Técnico
 *   1.9 §9.1 — asunto, AttachedDocument). Para C.3 minimo viable: el
 *   endpoint valida y registra el evento de auditoría, marcando que el
 *   reenvío fue solicitado. La pieza de correo/S3/ZIP es C.3.5 — siguiente
 *   slice cuando la DB vuelva, verificable por live curl.
 *
 * ## Lo que sí hace
 *
 * - Valida email con `class-validator.isEmail` (mismo helper que usa el
 *   servicio tienda — misma regla, mismo mensaje ERR-07).
 * - Valida que la factura existe y pertenece a la organización plataforma.
 * - Escribe una fila en `invoice_delivery_events` con `status='queued'`
 *   (la pieza de correo C.3.5 la actualizará a `sent`/`failed`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { isEmail } from 'class-validator';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { writeInvoiceDeliveryEvent } from '../../../store/invoicing/delivery/invoice-delivery-events.writer';

export interface PlatformDeliverResult {
  invoice_id: number;
  recipient: string;
  zip_name: string;
  status: 'queued';
}

@Injectable()
export class PlatformDeliveryService {
  private readonly logger = new Logger(PlatformDeliveryService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  /**
   * Reenvía una factura plataforma a un correo arbitrario.
   *
   * @param invoice_id id de la factura plataforma
   * @param recipient correo destino — debe pasar `class-validator.isEmail`
   * @param actor_user_id usuario que solicita el reenvío (auditoría)
   */
  async deliverInvoice(
    invoice_id: number,
    recipient: string,
    actor_user_id: number,
  ): Promise<PlatformDeliverResult> {
    // 1. Validar el correo con el mismo helper que el servicio tienda.
    //    `isEmail` de class-validator es el mismo que el DTO usa para
    //    validar — misma regla, mismo ERR-07.
    if (!recipient || !isEmail(recipient)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_001,
        `Correo inválido: "${recipient}". Debe ser una dirección de email válida.`,
        { recipient },
      );
    }

    // 2. Resolver ámbito plataforma.
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;

    // 3. Validar la factura existe y pertenece a la plataforma.
    const invoice = await this.prisma.withoutScope().invoices.findFirst({
      where: {
        id: invoice_id,
        organization_id: platformOrgId,
      },
      select: {
        id: true,
        invoice_number: true,
        invoice_type: true,
        status: true,
        cufe: true,
        pdf_url: true,
        xml_document: true,
        accounting_entity_id: true,
      },
    });
    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `La factura ${invoice_id} no pertenece a la organización plataforma ${platformOrgId}.`,
        { invoice_id, platform_organization_id: platformOrgId },
      );
    }

    // 4. Construir nombre del ZIP de salida (mismo patrón que el servicio
    //    tienda, con prefijo Factura-QA y el número del documento).
    const zip_name = `Factura-${invoice.invoice_number}.zip`;

    // 5. Escribir la fila de auditoría en `invoice_delivery_events` con
    //    `store_id: null` (H2: ya nullable) y `status: 'queued'`. La pieza
    //    C.3.5 de correo+S3 actualizará el status al resultado real.
    await writeInvoiceDeliveryEvent(this.prisma.withoutScope() as any, {
      invoice_id: invoice.id,
      organization_id: platformOrgId,
      store_id: null,
      channel: 'email',
      recipient,
      zip_name,
      status: 'queued',
      created_by: actor_user_id,
    });

    this.logger.log(
      `Platform delivery queued: invoice=${invoice.invoice_number} → ${recipient}`,
    );

    return {
      invoice_id: invoice.id,
      recipient,
      zip_name,
      status: 'queued',
    };
  }
}
