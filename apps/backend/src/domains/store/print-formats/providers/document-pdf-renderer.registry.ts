import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { IDocumentPdfRenderer } from '../interfaces/document-pdf-renderer.interface';

/**
 * ADR-15 §4 (CP-pos-exclusive-tax-double-charge, unificación
 * remisión-gateway) — registro de renderizadores del motor `engine:'pdf'`,
 * hermano de `DocumentDataProviderRegistry` pero para PDF en vez de HTML.
 *
 * Antes de esta unificación, `print-gateway.service.ts` tenía una lista
 * literal (`PDF_ENGINE_SUPPORTED_FORMATS`) declarada AL LADO de la lógica de
 * render, sin ninguna relación estructural con lo que en verdad estaba
 * cableado — exactamente el patrón que hace que una lista y su registro
 * diverjan tarde o temprano. Ahora ESTE registro es la única fuente de
 * verdad: `getSupportedFormats()` decide tanto si `engine:'pdf'` es válido
 * para un formato como qué enumerar en el mensaje de error cuando no lo es.
 */
@Injectable()
export class DocumentPdfRendererRegistry {
  private readonly logger = new Logger(DocumentPdfRendererRegistry.name);
  private readonly renderers = new Map<print_format_type_enum, IDocumentPdfRenderer>();

  register(formatType: print_format_type_enum, renderer: IDocumentPdfRenderer): void {
    this.renderers.set(formatType, renderer);
    this.logger.log(`Registered PDF renderer for format type: ${formatType}`);
  }

  getRenderer(formatType: print_format_type_enum): IDocumentPdfRenderer | undefined {
    return this.renderers.get(formatType);
  }

  hasRenderer(formatType: print_format_type_enum): boolean {
    return this.renderers.has(formatType);
  }

  getSupportedFormats(): print_format_type_enum[] {
    return Array.from(this.renderers.keys());
  }
}
