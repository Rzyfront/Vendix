import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { FiscalInvoicePdfRenderService } from './fiscal-invoice-pdf-render.service';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';

export interface RenderResult {
  format_type: print_format_type_enum;
  html?: string;
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

/** Formatos que hoy tienen motor PDF detrás del gateway. */
const PDF_ENGINE_SUPPORTED_FORMATS: print_format_type_enum[] = [
  'fiscal_electronic_invoice',
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
    const storeConfig = await this.prisma.store_print_format_configs.findFirst({
      where: {
        store_id: storeId,
        format_type: formatType,
      },
      include: {
        template: true,
      },
    });

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
        pdf_buffer = await this.pdfRenderer.renderBuffer(storeId, documentId);
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

    return {
      format_type: formatType,
      html,
      pdf_buffer,
      copies: effective.definition.paper.copies || 1,
      is_roll: effective.definition.paper.is_roll,
      width_mm: effective.definition.paper.width_mm,
    };
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
   */
  async preview(
    storeId: number,
    formatType: print_format_type_enum,
    overrides?: Record<string, any>,
    sampleDocId?: number,
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

    const html = this.composer.compose(previewDef, data);

    return {
      html,
      width_mm: previewDef.paper.width_mm,
      is_roll: previewDef.paper.is_roll,
      definition: previewDef,
    };
  }

  /**
   * Realiza un merge profundo y seguro entre la definición base y los overrides
   */
  private mergeDefinition(
    base: PrintFormatDefinition,
    overrides: Record<string, any>,
  ): PrintFormatDefinition {
    if (!overrides || Object.keys(overrides).length === 0) {
      return base;
    }

    return {
      ...base,
      paper: {
        ...base.paper,
        ...(overrides.paper || {}),
      },
      styles: {
        ...base.styles,
        ...(overrides.styles || {}),
      },
      sections: overrides.sections ? overrides.sections : base.sections,
      columns: overrides.columns ? overrides.columns : base.columns,
      custom_template: overrides.custom_template !== undefined ? overrides.custom_template : base.custom_template,
    };
  }
}
