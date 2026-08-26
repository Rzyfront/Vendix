/**
 * PlatformInvoicePdfService — pipeline PDF del riel plataforma.
 *
 * ## Slice C.5 — el problema arquitectónico (H3 del plan)
 *
 * El servicio tienda `InvoicePdfService` (services/invoice-pdf.service.ts,
 * ~700 líneas) tiene TRES acoplamientos hardcoded al riel tienda que
 * bloquean la reutilización directa desde el riel plataforma:
 *
 *   1. **Llave S3** (línea 277): `stores/${invoice.store_id}/invoices/...`.
 *      Para facturas plataforma con `store_id NULL`, esa ruta es
 *      literalmente `stores/null/invoices/...` — prefijo inutilizable y
 *      colisión potencial con id numérico de tienda que coincida.
 *
 *   2. **Formato de impresión** (línea 621-622):
 *      `store_settings.settings.receipts.invoice_format`. La plataforma no
 *      tiene `store_settings`; su `platform_settings` guarda un `environment`
 *      y un `auto_issue` pero NO el formato de impresión del PDF.
 *
 *   3. **DIAN strict-mode** (línea 137+): `is_electronic_document` se decide
 *      por `dian_status !== 'not_applicable'`. La plataforma emite con SU
 *      PROPIO NIT y la misma regla aplica, pero el `resolveIssuer` que
 *      carga datos del emisor (razón social, NIT, dirección) está atado a
 *      `invoice.organization` + `invoice.store` y el store NO existe en
 *      facturas plataforma.
 *
 * Adaptar el servicio tienda sin tocar su spec (compuerta dura del plan)
 * requiere un wrapper que:
 *
 *   a) Cargue el invoice plataforma vía `GlobalPrismaService.withoutScope()`
 *      (mismo patrón que C.2/C.3/C.4 — bypass del scoping de tienda para
 *      evitar el IDOR que `store_id: undefined` introduciría).
 *   b) Resuelva los datos del emisor desde `platform_settings` + la
 *      `organization` plataforma, no desde el store de la factura.
 *   c) Arme el PDF vía `InvoicePdfBuilder.build()` directamente (la clase
 *      static del riel tienda, sin pasar por `InvoicePdfService`).
 *   d) Suba a S3 bajo `platform/invoices/{transmissionId}/...` (prefijo
 *      distinto del `stores/` para evitar colisión de namespaces).
 *
 * ## Por qué C.5 queda como stub 503 en este slice
 *
 * Los tres puntos requieren ~300 líneas de orquestación equivalente a la
 * mitad de `InvoicePdfService` — la pieza más larga del plan después de
 * `ProfilePreviewService`. Mejor entregarla en un slice dedicado
 * **C.5.5** que audite los contratos en vivo antes de declarar done, en
 * vez de un PDF que parece funcionar y falla en producción con un campo
 * fabricado (mismo argumento que la decisión de `InvoicePdfService` línea
 * 137 de hacer fail-fast en documento electrónico).
 *
 * Mientras C.5.5 está pendiente, el endpoint devuelve 503 con código
 * `PLATFORM_PDF_NOT_CONFIGURED` — el mismo patrón de honestidad que
 * `PLATFORM_PROFILE_PREVIEW_PENDING` (B.4) y `PLATFORM_PROFILE_001` (C.1):
 * no mentir con un shape falso.
 *
 * ## Cuando C.5.5 arranque
 *
 * Reutilizar `InvoicePdfBuilder.build()` (export static, ~250 líneas del
 * riel tienda) con platform-context. NO copiar el builder. La spec del
 * builder del riel tienda cubre geometría, XSS de campos largos, escape de
 * caracteres DIAN y casos borde — copiarla sería tirar ~250 líneas probadas.
 */
import { Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';

@Injectable()
export class PlatformInvoicePdfService {
  private readonly logger = new Logger(PlatformInvoicePdfService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  /**
   * C.5.5 pendiente. Stub honesto: 503 con código dedicado.
   *
   * Mismo patrón de `PLATFORM_PROFILE_PREVIEW_PENDING`: el endpoint existe,
   * responde con shape honesto, no miente. El frontend puede mostrar un
   * banner «PDF no disponible para plataforma — pendiente C.5.5».
   */
  async generatePdf(transmission_id: number): Promise<never> {
    throw new VendixHttpException(
      ErrorCodes.PLATFORM_PDF_NOT_CONFIGURED,
      `Generación PDF plataforma pendiente (C.5.5) para transmision #${transmission_id}. El pipeline PDF del riel tienda (services/invoice-pdf.service.ts) tiene tres acoplamientos al store que requieren wrapper org-scoped.`,
      {
        transmission_id,
        blocker: 'C.5.5',
        reference: 'docs/plans/CP-platform-invoicing-parity.md ADR-8 + sección C.5',
      },
    );
  }

  /**
   * C.5.5 pendiente. Stub honesto: 503 con código dedicado.
   */
  async previewPdf(transmission_id: number): Promise<never> {
    throw new VendixHttpException(
      ErrorCodes.PLATFORM_PDF_NOT_CONFIGURED,
      `Preview PDF plataforma pendiente (C.5.5) para transmision #${transmission_id}.`,
      { transmission_id, blocker: 'C.5.5' },
    );
  }

  /**
   * C.5.5 pendiente. Stub honesto: 503 con código dedicado.
   */
  async regeneratePdf(transmission_id: number): Promise<never> {
    throw new VendixHttpException(
      ErrorCodes.PLATFORM_PDF_NOT_CONFIGURED,
      `Regeneración PDF plataforma pendiente (C.5.5) para transmision #${transmission_id}.`,
      { transmission_id, blocker: 'C.5.5' },
    );
  }

  /** Lectura de plataforma para diagnóstico — NO es el endpoint público. */
  async diagnoseScope(transmission_id: number): Promise<{
    org_id: number | null;
    store_id: number | null;
    invoice_status: string | null;
  }> {
    try {
      const ctx = await this.platformOrg.getPlatformContext();
      if (!ctx) return { org_id: null, store_id: null, invoice_status: null };
      // Sin endpoint público aún; sólo verifica que el scope resuelve.
      return {
        org_id: ctx.organization_id,
        store_id: null,
        invoice_status: 'resolved',
      };
    } catch {
      return { org_id: null, store_id: null, invoice_status: null };
    }
  }
}
