import { Injectable, Logger, Optional } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { FiscalInvoicePdfRenderService } from './fiscal-invoice-pdf-render.service';
// [print-editor-dsk P2.2] — Single render path service. Wraps the
// composer's HTML with explicit pixel dimensions so the preview no longer
// relies on `srcdoc` + `doc.write` double-render or magic `3.78` math.
import { PrintDocumentRendererService } from './print-document-renderer.service';
// [print-editor-dsk P9] — Prometheus instrumentation: histogram of render
// duration, labeled by `format_type` / `engine` / `organization_id`. The
// service is a thin adapter (see `print-gateway.metrics.ts`); the gateway
// owns the timer and the `organization_id` resolution so the metric line
// and the existing logger line stay co-located.
import { PrintGatewayMetricsService } from './print-gateway.metrics';
import {
  PrintColumnDefinition,
  PrintFormatDefinition,
  PrintSectionDefinition,
  PrintTokenDefinition,
} from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';

export interface RenderResult {
  format_type: print_format_type_enum;
  html?: string;
  /**
   * [print-fiscal-gate P7.2] — Cuando el caller pidió `body_only=true`,
   * `html`` contiene SOLO el contenido interior del `<body>`. Cuando pidió
   * `body_only=false` (default), contiene el documento HTML completo.
   * Misma key para no romper el shape histórico; el caller decide cómo
   * envolver.
   */
  body_only?: boolean;
  /**
   * PDF bajo demanda — E.11 casilla 4, slice 1. Declarado desde el día uno y
   * JAMÁS lleno hasta ahora: `engine:'pdf'` se aceptaba en el DTO y el cuerpo
   * lo ignoraba.
   *
   * Hoy se llena SÓLO para `fiscal_electronic_invoice`, llamando al builder
   * pdfkit existente como MOTOR (`FiscalInvoicePdfRenderService` →
   * `InvoicePdfBuilder`) sobre el ensamblador propio del builder — NUNCA sobre
   * el `StandardPrintDataModel`, que medido pierde la retención y puede
   * imprimir un NIT que discrepe del XML. SIN persistencia: sin S3, sin
   * `pdf_url`, sin eventos — eso sigue siendo carril exclusivo de
   * `generatePdf`. El Buffer es de render, no un artefacto archivado.
   */
  pdf_buffer?: Buffer;
  copies: number;
  is_roll: boolean;
  width_mm: number;
}

/** Formatos que hoy tienen motor PDF detrás del gateway.
 *
 * [print-editor-dsk P8] — `fiscal_credit_note` entra al motor PDF. La nota
 * crédito electrónica comparte el mismo builder pdfkit que la factura
 * (`InvoicePdfBuilder.generate`) y el mismo resolvedor de identidad fiscal
 * (`resolveFiscalIssuerForPrint`) — la única diferencia es el texto del
 * sello y el del CUDE/CUFE; el resto del layout (papel, doble pasada de
 * rollo, QR §11.7) es idéntico. El render distingue el documento por la
 * fila `invoices.invoice_type`, no por el `format_type`.
 */
const PDF_ENGINE_SUPPORTED_FORMATS: print_format_type_enum[] = [
  'fiscal_electronic_invoice',
  'fiscal_credit_note',
];

@Injectable()
export class PrintGatewayService {
  private readonly logger = new Logger(PrintGatewayService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly registry: DocumentDataProviderRegistry,
    private readonly composer: PrintLayoutComposerService,
    private readonly fiscalValidator: PrintFiscalValidatorService,
    private readonly pdfRenderer: FiscalInvoicePdfRenderService,
    // [print-editor-dsk P9] — Injected via constructor; `print-formats.module.ts`
    // provides it. Marked `@Optional()` so existing unit tests that build the
    // gateway manually (engine-pdf, profile-template, merge-definition specs)
    // do not need to wire a Prometheus stub. Production deployments always
    // register the provider via the module.
    @Optional()
    private readonly metrics?: PrintGatewayMetricsService,
  ) {}

  /**
   * Resuelve la configuración efectiva de un formato para una tienda
   */
  async resolveEffectiveConfig(
    storeId: number,
    formatType: print_format_type_enum,
    templateIdOverride?: number | null,
  ): Promise<{
    configId?: number;
    definition: PrintFormatDefinition;
    is_active: boolean;
    gateway_enabled: boolean;
    is_customized: boolean;
  }> {
    // 1. Buscar configuración guardada de la tienda
    let storeConfig = await this.prisma.store_print_format_configs.findFirst({
      where: {
        store_id: storeId,
        format_type: formatType,
      },
      include: {
        template: true,
      },
    });

    // 1.b. Auto-siembra — primera vez que la tienda renderiza un formato que
    //     nunca configuró en el Hub. Sin esto, una tienda que abre sin tocar
    //     la pantalla de impresión recibe PRINT_FORMAT_NOT_FOUND_001 al primer
    //     tiquete de la primera venta — un 500 silencioso disfrazado de error
    //     de aplicación. La fila se crea en estado por-defecto del sistema:
    //     `is_active=true`, `gateway_enabled=false` (= usa plantilla del
    //     sistema, NO legacy), `overrides=null`. El motor nuevo es el único
    //     que imprime; el flag ya no decide "qué motor", sólo "qué plantilla".
    //
    //     `templateIdOverride` BYPASA la auto-siembra: si el caller pasó una
    //     plantilla específica, esa fila debe existir primero (la crea el Hub),
    //     y sembrar una por defecto competiría con la elección explícita.
    if (!storeConfig && !templateIdOverride) {
      storeConfig = await this.ensureStorePrintConfig(storeId, formatType);
    }

    let baseDefinition: PrintFormatDefinition | null = null;
    let templateFound = false;

    // 0. Plantilla EXPLÍCITA (la que congeló el perfil de facturación).
    //
    // Va antes de la de la tienda a propósito: el documento se imprime con el
    // diseño que su perfil eligió, no con el que la tienda tenga activo hoy.
    //
    // Dos decisiones que no son cosméticas:
    //
    // a) La consulta filtra por `format_type` Y por dueño. Sin el filtro de
    //    dueño, un id de plantilla convertido en parámetro sería un IDOR entre
    //    organizaciones; sin el de `format_type`, una factura se podría
    //    renderizar con la plantilla de una comanda de cocina y el validador
    //    fiscal la rechazaría por ausencias que nadie relacionaría con esto.
    //
    // b) Si la plantilla no aparece NO se lanza: se cae a la cadena normal y se
    //    deja advertencia. Una plantilla borrada después de timbrar la factura
    //    no puede volver imposible reimprimir un documento ya emitido.
    if (templateIdOverride) {
      const owned = await this.resolveOwnedTemplate(storeId, formatType, templateIdOverride);
      if (owned) {
        baseDefinition = owned as unknown as PrintFormatDefinition;
        templateFound = true;
      } else {
        this.logger.warn(
          `PrintGateway: la plantilla ${templateIdOverride} no existe para ${formatType} en la tienda ${storeId}; se usa la plantilla activa de la tienda.`,
        );
      }
    }

    if (baseDefinition) {
      // Los `overrides` de la tienda se escribieron CONTRA OTRA base. Aplicarlos
      // sobre esta plantilla mezclaría dos diseños y produciría un documento que
      // nadie diseñó. Con plantilla explícita se imprime la plantilla, limpia.
      return {
        configId: storeConfig?.id,
        definition: baseDefinition,
        is_active: storeConfig?.is_active ?? true,
        gateway_enabled: storeConfig?.gateway_enabled ?? false,
        is_customized: true,
      };
    }

    if (storeConfig?.template?.definition) {
      baseDefinition = storeConfig.template.definition as unknown as PrintFormatDefinition;
      templateFound = true;
    } else {
      // 2. Buscar plantilla del sistema para este tipo
      const systemTemplate = await this.prisma.print_templates.findFirst({
        where: {
          is_system: true,
          format_type: formatType,
        },
      });

      if (systemTemplate?.definition) {
        baseDefinition = systemTemplate.definition as unknown as PrintFormatDefinition;
      }
    }

    if (!baseDefinition) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_FORMAT_NOT_FOUND_001,
        `No se encontró plantilla base para el formato: ${formatType}`,
      );
    }

    // 3. Aplicar overrides si existen
    const overrides = (storeConfig?.overrides as Record<string, any>) || {};
    const effectiveDefinition = this.mergeDefinition(baseDefinition, overrides);

    return {
      configId: storeConfig?.id,
      definition: effectiveDefinition,
      is_active: storeConfig?.is_active ?? true,
      gateway_enabled: storeConfig?.gateway_enabled ?? false,
      is_customized: Boolean(storeConfig?.overrides || templateFound),
    };
  }

  /**
   * Renderiza un documento completo a través del Gateway
   *
   * La plantilla NO llega del cliente: se lee del perfil que la factura
   * congeló al emitirse. Que el cliente la pudiera elegir significaría que dos
   * impresiones del MISMO documento fiscal pueden verse distintas, y una
   * reimpresión debe ser idéntica a la primera.
   *
   * E.11 casilla 4 (slice 1) — `engine` ya no es decoración:
   *
   * - `'html'` (default): el HTML compuesto con la plantilla congelada del
   *   perfil, como siempre.
   * - `'pdf'`: además del HTML, llena `RenderResult.pdf_buffer` llamando al
   *   builder pdfkit existente como MOTOR (`FiscalInvoicePdfRenderService`),
   *   SIN persistir en S3 — el carril de S3 sigue siendo `generatePdf`. Sólo
   *   para `fiscal_electronic_invoice`: pedirlo para otro formato es un 422,
   *   no un HTML que hace pasar por PDF.
   *
   * Reparto plantilla/motor (decisión E.11): en HTML la plantilla manda sobre
   * el contenido; en PDF el builder manda POR FIDELIDAD — rollo medido, sello
   * QR §11.7 por página y tipografía escalada no tienen equivalente CSS fiel.
   * El acople fino template→pdfkit es el slice 2; hoy el PDF sale del mismo
   * ensamblador que produce el artefacto legal, así que los importes, el CUFE
   * y las letras cuadran con el XML por construcción (paridad verificada en
   * spec). El HTML sigue componiéndose también en el carril pdf: viaja junto
   * al Buffer como evidencia de la plantilla elegida y soporte de la paridad.
   */
  async renderDocument(
    storeId: number,
    formatType: print_format_type_enum,
    documentId: number | string,
    engine: 'html' | 'pdf' = 'html',
    bodyOnly: boolean = false,
  ): Promise<RenderResult> {
    const start = Date.now();
    if (
      engine === 'pdf' &&
      !PDF_ENGINE_SUPPORTED_FORMATS.includes(formatType)
    ) {
      // Dejar de mentir incluye negarse: devolver HTML cuando pidieron PDF fue
      // exactamente el defecto de origen («aceptado e ignorado»).
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El motor 'pdf' no está disponible para el formato ${formatType}; formatos con motor PDF: ${PDF_ENGINE_SUPPORTED_FORMATS.join(', ')}.`,
      );
    }
    const profileTemplateId = await this.resolveProfileTemplateId(
      storeId,
      formatType,
      documentId,
    );
    const effective = await this.resolveEffectiveConfig(
      storeId,
      formatType,
      profileTemplateId,
    );

    if (!effective.is_active) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'El formato de impresión se encuentra desactivado para esta tienda.',
      );
    }

    // Validar conformidad fiscal si aplica
    this.fiscalValidator.assertFiscalCompliance(formatType, effective.definition);

    let pdf_buffer: Buffer | undefined;
    if (engine === 'pdf') {
      try {
        // [print-editor-dsk P8] — Pasamos `formatType` para que el motor
        // distinga `fiscal_electronic_invoice` de `fiscal_credit_note` por
        // la columna `invoices.invoice_type`, evitando que un id de factura
        // renderice con la etiqueta de nota (o viceversa). El resto del
        // render es idéntico: mismo builder pdfkit, misma resolución de
        // papel, misma identidad fiscal.
        pdf_buffer = await this.pdfRenderer.renderBuffer(storeId, documentId, formatType);
        // TODO(integration-slice-4): thread `paper_definition` from caller
        //   - Cuando `RenderPrintDocumentDto` extienda `paper_format`
        //     (opción B del plan E.11), pasarlo aquí a `renderBuffer` por
        //     una segunda sobrecarga o por un tercer argumento opcional.
        //   - El fallback natural es `effective.definition.paper.format`
        //     (la plantilla congelada del perfil), NO el setting de tienda
        //     (`receipts.invoice_format`) que hoy manda dentro del render —
        //     eso es lo que ata el PDF al MISMO formato que eligió el
        //     perfil, y es lo que hace que dos reimpresiones del mismo
        //     documento sean idénticas.
        //   - Slice 3 ya cablea `resolvePaperDefinition` en
        //     `FiscalInvoicePdfRenderService` (territorio del propio
        //     render), así que este TODO es PURO para slice 4: traer el
        //     override desde el gateway, no añadirlo aquí.
      } catch (error) {
        // Los errores de dominio ya tipados (documento ausente, identidad
        // fiscal incompleta) conservan su código y su HTTP status; lo que se
        // degrada es el fallo anónimo del motor.
        if (error instanceof VendixHttpException) throw error;
        throw new VendixHttpException(
          ErrorCodes.PRINT_GATEWAY_RENDER_FAILED_001,
          `Falló el render PDF del documento ${documentId}: ${(error as Error)?.message}`,
        );
      }
    }

    // Obtener datos del provider
    const provider = this.registry.getProvider(formatType);
    const data = await provider.fetchDocumentData(storeId, documentId);

    // Componer HTML
    const html = this.composer.compose(effective.definition, data);

    const elapsed = Date.now() - start;
    this.logger.log(
      `PrintGateway rendered ${formatType} for doc ${documentId} (store ${storeId}, engine ${engine}) in ${elapsed}ms`,
    );

    // [print-editor-dsk P9] — Prometheus observation. We resolve the
    // `organization_id` here (best-effort) so the histogram carries the
    // tenant label. The lookup is a single-row findFirst on the PK of
    // `stores` (the same row the gateway already loaded indirectly via the
    // provider's `fetchDocumentData`); it does not introduce a new join.
    // On failure (deleted store, AsyncLocalStorage drift) we emit under a
    // sentinel label so the metric is never silently dropped.
    let organizationId = 'unknown';
    try {
      const storeRow = await this.prisma.stores.findFirst({
        where: { id: storeId },
        select: { organization_id: true },
      });
      if (storeRow?.organization_id != null) {
        organizationId = String(storeRow.organization_id);
      }
    } catch {
      // Swallow — Prometheus must NEVER break a render.
    }
    this.metrics?.observe({
      format_type: formatType,
      engine,
      organization_id: organizationId,
      duration_seconds: elapsed / 1000,
    });

    return {
      format_type: formatType,
      html: bodyOnly ? this.extractBodyContent(html) : html,
      pdf_buffer,
      body_only: bodyOnly,
      copies: effective.definition.paper.copies || 1,
      is_roll: effective.definition.paper.is_roll,
      width_mm: effective.definition.paper.width_mm,
    };
  }

  /**
   * [print-fiscal-gate P7.2] — Extrae SOLO el contenido interior del `<body>`
   * de un documento renderizado por el composer. El composer devuelve un
   * `<!DOCTYPE html><html ...><head>...</head><body>CONTENIDO</body></html>`
   * completo; el batch de impresión necesita los cuerpos por separado para
   * concatenarlos con `break-after: page` y envolver UNA vez con un único
   * `<html>`.
   *
   * La extracción es robusta frente a los dos formatos que produce el
   * composer: con y sin `<!DOCTYPE>`, con y sin espacio entre atributos.
   * Si el regex no casa, devolvemos el HTML crudo: preferible eso a lanzar
   * un 500 en mitad de un lote, y el caller puede diagnosticar el documento
   * malformado por separado.
   */
  private extractBodyContent(html: string): string {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (!bodyMatch) {
      this.logger.warn(
        'PrintGateway: extractBodyContent no encontró <body>; se devuelve el HTML crudo.',
      );
      return html;
    }
    return bodyMatch[1];
  }

  /**
   * Plantilla del Hub verificada contra el tipo de formato y el dueño.
   *
   * `print_templates` es un modelo de ORGANIZACIÓN y el cliente de esta clase
   * es el de TIENDA, que no lo alcanza con su filtro: por eso el dueño se filtra
   * a mano. La organización se deriva de la tienda —no del contexto de la
   * petición— para que la regla siga valiendo si algún día esto se llama desde
   * una cola, donde no hay contexto.
   */
  private async resolveOwnedTemplate(
    storeId: number,
    formatType: print_format_type_enum,
    templateId: number,
  ): Promise<unknown | null> {
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store?.organization_id) return null;

    const template = await this.prisma.print_templates.findFirst({
      where: {
        id: templateId,
        format_type: formatType,
        OR: [{ is_system: true }, { organization_id: store.organization_id }],
      },
      select: { definition: true },
    });

    return template?.definition ?? null;
  }

  /**
   * Auto-siembra de la configuración por defecto de la tienda.
   *
   * Devuelve la fila creada (o `null` si no hay plantilla del sistema que sembrar
   * — en ese caso el caller recibe el PRINT_FORMAT_NOT_FOUND_001 honesto, que
   * ya no es "el merchant nunca configuró" sino "el operador de plataforma no
   * sembró la plantilla del sistema para este formato", un error de datos que
   * requiere acción de Vendix, no del merchant).
   *
   * El `try/catch` alrededor del `create` cubre la carrera entre dos renders
   * concurrentes que llegan al auto-seed a la vez: el primero crea, el segundo
   * cae en P2002 por el `@@unique([store_id, format_type])` y relee el ya
   * existente. NO se eleva como error al caller: el resultado funcional es el
   * mismo (la fila existe), y un fallo aquí dejaría a una tienda sin poder
   * imprimir durante una ventana de milisegundos que ningún operador humano
   * notaría pero que sí se notaría en métricas.
   */
  private async ensureStorePrintConfig(
    storeId: number,
    formatType: print_format_type_enum,
  ) {
    const systemTemplate = await this.prisma.print_templates.findFirst({
      where: { is_system: true, format_type: formatType },
      select: { id: true },
    });
    if (!systemTemplate) {
      return null;
    }

    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store?.organization_id) {
      return null;
    }

    try {
      return await this.prisma.store_print_format_configs.create({
        data: {
          store_id: storeId,
          organization_id: store.organization_id,
          format_type: formatType,
          is_active: true,
          // gateway_enabled=false ⇒ usa plantilla del sistema (la única sembrada
          // aquí). El motor nuevo sigue siendo el que imprime; este flag ya no
          // decide "qué motor", sólo "qué plantilla".
          gateway_enabled: false,
          template_id: systemTemplate.id,
          overrides: undefined,
        },
        include: { template: true },
      });
    } catch (err) {
      // P2002 = otro render ganó la carrera. Releer y devolver la fila existente.
      this.logger.debug(
        `PrintGateway: carrera de auto-siembra para store=${storeId} format=${formatType}; releyendo fila existente (${(err as { code?: string })?.code ?? 'unknown'}).`,
      );
      return this.prisma.store_print_format_configs.findFirst({
        where: { store_id: storeId, format_type: formatType },
        include: { template: true },
      });
    }
  }

  /**
   * Plantilla que el perfil de facturación congeló para este documento.
   *
   * Se lee de `invoice_profile_versions`, no de `invoice_profiles`: la factura
   * apunta a la VERSIÓN, que es inmutable. Leer el perfil vivo haría que editar
   * un perfil cambiara el diseño de facturas ya timbradas.
   *
   * Sólo aplica a la factura electrónica. Las notas crédito no traen las
   * columnas del perfil, así que no hay nada que resolver para ellas; devolver
   * `null` las deja en la plantilla activa de la tienda, que es lo que hacían
   * antes de este cambio.
   *
   * DECISIÓN (E.9) — esta lectura y la de `fiscal-invoice.provider.ts:33`
   * (`FISCAL_DOCUMENT_PRINT_INCLUDE`) leen la MISMA fila de `invoices` en la
   * misma petición (esta antes, para resolver la plantilla; la del proveedor
   * después, dentro de `fetchDocumentData`), y NO se fusionan. Medido: ésta es
   * una sonda de UNA columna (`profile_snapshot.config`) sobre un `id` que ya
   * es la PK — el costo real es un `findFirst` extra indexado por PK, no un
   * N+1 sobre una colección. Fusionarlas exigiría que este servicio —genérico,
   * usado por TODOS los `formatType` (`kitchen_ticket`, `dispatch_note`,
   * `quotation`, etc., ninguno de los cuales usa `FISCAL_DOCUMENT_PRINT_INCLUDE`)—
   * importe una proyección que pertenece a un proveedor concreto de un dominio
   * fiscal, invirtiendo la dirección de dependencia correcta (gateway →
   * provider, nunca al revés) a cambio de ahorrar una consulta de una columna
   * por PK. No vale la pena: se deja separada.
   */
  private async resolveProfileTemplateId(
    storeId: number,
    formatType: print_format_type_enum,
    documentId: number | string,
  ): Promise<number | null> {
    if (formatType !== 'fiscal_electronic_invoice') return null;

    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: storeId },
      select: { profile_snapshot: { select: { config: true } } },
    });

    const config = invoice?.profile_snapshot?.config as
      | { format?: { template_id?: unknown } }
      | null
      | undefined;
    const templateId = config?.format?.template_id;

    return typeof templateId === 'number' && Number.isInteger(templateId) && templateId > 0
      ? templateId
      : null;
  }

  /**
   * Genera una vista previa instantánea con datos de prueba o documento real
   *
   * [print-editor-dsk P2.2] — El HTML devuelto sale ENVUELTO por
   * `PrintDocumentRendererService`, así el preview ya lleva dimensiones
   * explícitas en píxeles (`width: Npx`) y un único contenedor
   * `.vendix-print-page`. Antes el frontend re-renderizaba el HTML en un
   * `<iframe srcdoc>` y aplicaba `Math.max(w * 3.78, 300)`, dos defectos
   * que sobre-escalaban thermal_58 a 300px y trataban letter/a4/half_letter
   * como un flat de 600px. Aquí el backend pasa la caja exacta.
   */
  async preview(
    storeId: number,
    formatType: print_format_type_enum,
    overrides?: Record<string, any>,
    sampleDocId?: number,
    renderMode?: 'dummy' | 'tokenized' | 'real',
  ): Promise<{ html: string; width_mm: number; is_roll: boolean; definition: PrintFormatDefinition }> {
    const effective = await this.resolveEffectiveConfig(storeId, formatType);
    const previewDef = overrides ? this.mergeDefinition(effective.definition, overrides) : effective.definition;

    const provider = this.registry.getProvider(formatType);
    let data: StandardPrintDataModel;

    if (sampleDocId) {
      try {
        data = await provider.fetchDocumentData(storeId, sampleDocId);
      } catch (e) {
        data = await provider.getSampleData(storeId);
      }
    } else {
      data = await provider.getSampleData(storeId);
    }

    // Always enrich sample preview with the real store logo and business data if available
    data = await this.enrichDataWithStoreIdentity(storeId, data);

    const html = this.composer.compose(
      previewDef,
      data,
      renderMode === 'tokenized' ? 'tokenized' : 'dummy',
    );

    return {
      html,
      width_mm: previewDef.paper.width_mm,
      is_roll: previewDef.paper.is_roll,
      definition: previewDef,
    };
  }

  /**
   * Enriches standard print data with the store's real identity (logo, name, NIT, address)
   * so previews immediately reflect the store's branding.
   */
  private async enrichDataWithStoreIdentity(
    storeId: number,
    data: StandardPrintDataModel,
  ): Promise<StandardPrintDataModel> {
    try {
      const store = await this.prisma.stores.findFirst({
        where: { id: storeId },
        include: {
          addresses: { take: 1 },
          organizations: true,
        },
      });
      if (store) {
        const storeLogo = store.logo_url || store.organizations?.logo_url || undefined;
        const addr = store.addresses?.[0];
        const addressLine = addr?.address_line1 || undefined;
        const city = addr?.city || undefined;
        const stateProv = (addr as any)?.state || addr?.state_province || undefined;

        data.store = {
          ...data.store,
          name: store.name || data.store.name,
          legal_name: store.organizations?.legal_name || store.name || data.store.legal_name,
          tax_id: store.tax_id || store.organizations?.tax_id || data.store.tax_id,
          phone: (store as any).phone || data.store.phone,
          email: (store as any).email || data.store.email,
          address: addressLine || data.store.address,
          city: city || data.store.city,
          state_province: stateProv || data.store.state_province,
          tax_regime: (store as any).tax_regime || data.store.tax_regime,
          logo_url: storeLogo || data.store.logo_url,
        };

        if (!data.organization && store.organizations) {
          data.organization = {
            name: store.organizations.name,
            legal_name: store.organizations.legal_name || store.organizations.name,
            tax_id: store.organizations.tax_id || undefined,
            logo_url: store.organizations.logo_url || undefined,
          };
        }
      }
    } catch (err) {
      this.logger.warn(
        `PrintGateway: no se pudo enriquecer datos con identidad de tienda ${storeId}: ${err}`,
      );
    }
    return data;
  }

  /**
   * Realiza un merge profundo y seguro entre la definición base y los overrides.
   *
   * Reglas (P1.4):
   * - `paper` se mezcla campo a campo; si llegan márgenes per-side (`v2`) se
   *   descarta el `margin_mm` legado para que el composer no aplique dos veces.
   * - `styles` se mezcla superficialmente.
   * - `sections`, `columns` y `tokens` se mezclan POR IDENTIDAD (id / path):
   *   si el override trae el mismo id, reemplaza la entrada; si trae un id
   *   nuevo, se conserva el resto y el nuevo se añade al final.
   * - `logo`, `company_block` y `custom_template` sólo se sustituyen si la
   *   clave aparece EXPLÍCITAMENTE en el override (no se pisan con `null`/
   *   `undefined` accidentales del Hub).
   */
  private mergeDefinition(
    base: PrintFormatDefinition,
    overrides: Record<string, any>,
  ): PrintFormatDefinition {
    if (!overrides || Object.keys(overrides).length === 0) {
      return base;
    }

    const v = (overrides.v ?? base.v ?? 2) as PrintFormatDefinition['v'];

    const merged: PrintFormatDefinition = {
      ...base,
      v,
      paper: overrides.paper
        ? {
            ...base.paper,
            ...overrides.paper,
            // Si llegan márgenes v2 per-side, el legado `margin_mm` ya no debe
            // ganar: el composer prefiere los per-side y el legado caería a
            // piso uniforme, anulando la asimetría del override.
            margin_mm:
              overrides.paper.margin_top_mm !== undefined ||
              overrides.paper.margin_right_mm !== undefined ||
              overrides.paper.margin_bottom_mm !== undefined ||
              overrides.paper.margin_left_mm !== undefined
                ? undefined
                : overrides.paper.margin_mm ?? base.paper.margin_mm,
          }
        : base.paper,
      styles: overrides.styles
        ? { ...(base.styles ?? {}), ...overrides.styles }
        : base.styles,
    };

    // Sections: deep merge por id (mismo id → reemplaza, id nuevo → append).
    if (overrides.sections) {
      const baseSections = base.sections ?? [];
      const overrideSections = overrides.sections as PrintSectionDefinition[];
      const overrideIds = new Set(overrideSections.map((s) => s.id));
      const unchanged = baseSections.filter((s) => !overrideIds.has(s.id));
      merged.sections = [...unchanged, ...overrideSections];
    }

    // Columns: deep merge por id (mismo id → reemplaza, id nuevo → append).
    if (overrides.columns) {
      const baseColumns = base.columns ?? [];
      const overrideColumns = overrides.columns as PrintColumnDefinition[];
      const overrideIds = new Set(overrideColumns.map((c) => c.id));
      const unchanged = baseColumns.filter((c) => !overrideIds.has(c.id));
      merged.columns = [...unchanged, ...overrideColumns];
    }

    // Tokens: unión por `path` (mismo path → gana override, path nuevo → append).
    if (overrides.tokens) {
      const baseTokens = base.tokens ?? [];
      const overrideTokens = overrides.tokens as PrintTokenDefinition[];
      const overridePaths = new Set(overrideTokens.map((t) => t.path));
      const unchanged = baseTokens.filter((t) => !overridePaths.has(t.path));
      merged.tokens = [...unchanged, ...overrideTokens];
    }

    // `logo` y `company_block` sólo se sustituyen si la clave aparece
    // EXPLÍCITAMENTE en el override (no se pisan con `undefined` accidentales).
    if ('logo' in overrides) {
      merged.logo = overrides.logo as PrintFormatDefinition['logo'];
    }
    if ('company_block' in overrides) {
      merged.company_block = overrides.company_block as PrintFormatDefinition['company_block'];
    }
    if ('custom_template' in overrides) {
      merged.custom_template = overrides.custom_template as string | undefined;
    }

    return merged;
  }
}
