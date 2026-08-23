import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';

export interface RenderResult {
  format_type: print_format_type_enum;
  html?: string;
  pdf_buffer?: Buffer;
  copies: number;
  is_roll: boolean;
  width_mm: number;
}

@Injectable()
export class PrintGatewayService {
  private readonly logger = new Logger(PrintGatewayService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly registry: DocumentDataProviderRegistry,
    private readonly composer: PrintLayoutComposerService,
    private readonly fiscalValidator: PrintFiscalValidatorService,
  ) {}

  /**
   * Resuelve la configuración efectiva de un formato para una tienda
   */
  async resolveEffectiveConfig(
    storeId: number,
    formatType: print_format_type_enum,
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
   */
  async renderDocument(
    storeId: number,
    formatType: print_format_type_enum,
    documentId: number | string,
    engine: 'html' | 'pdf' = 'html',
  ): Promise<RenderResult> {
    const start = Date.now();
    const effective = await this.resolveEffectiveConfig(storeId, formatType);

    if (!effective.is_active) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'El formato de impresión se encuentra desactivado para esta tienda.',
      );
    }

    // Validar conformidad fiscal si aplica
    this.fiscalValidator.assertFiscalCompliance(formatType, effective.definition);

    // Obtener datos del provider
    const provider = this.registry.getProvider(formatType);
    const data = await provider.fetchDocumentData(storeId, documentId);

    // Componer HTML
    const html = this.composer.compose(effective.definition, data);

    const elapsed = Date.now() - start;
    this.logger.log(
      `PrintGateway rendered ${formatType} for doc ${documentId} (store ${storeId}) in ${elapsed}ms`,
    );

    return {
      format_type: formatType,
      html,
      copies: effective.definition.paper.copies || 1,
      is_roll: effective.definition.paper.is_roll,
      width_mm: effective.definition.paper.width_mm,
    };
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
