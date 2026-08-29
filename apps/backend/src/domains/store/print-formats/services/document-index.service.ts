import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';

/**
 * [print-editor-dsk P3.1] — Indice liviano de documentos recientes por
 * formato. El editor del Hub (`previewFormat`) llama hoy a
 * `provider.getSampleData()` cuando el usuario no elige un documento del
 * picker; este servicio alimenta ese picker con documentos REALES del
 * store, así el preview deja de mostrar la muestra estática.
 *
 * Diseño: el servicio NO conoce el esquema de cada formato. Delega a
 * `provider.listRecent()` (método opcional introducido en P3.1). Si el
 * provider no lo implementa — el caso de `transfer_note` y
 * `kitchen_ticket`, cuyos lectores reales llegan en Fase 8 — devuelve
 * `[]` para que el editor degrade a la muestra sin 500.
 *
 * El cap de 50 lo imponemos en el servicio y NO en el provider: así el
 * provider puede aceptar cualquier número y la protección es uniforme
 * para los once formatos, sin riesgo de que uno solo olvide el cap.
 */
@Injectable()
export class DocumentIndexService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly registry: DocumentDataProviderRegistry,
  ) {}

  /**
   * Lista los N documentos más recientes del formato para la tienda.
   * `limit` se capa a 50 — el picker del Hub rara vez pide más de 20 y
   * un cap fijo protege a los providers de un ORDER BY sin LIMIT.
   */
  async listRecent(
    storeId: number,
    formatType: string,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    if (!formatType) return [];
    if (!this.registry.hasProvider(formatType as print_format_type_enum)) {
      return [];
    }
    const provider = this.registry.getProvider(
      formatType as print_format_type_enum,
    );
    if (typeof (provider as any).listRecent !== 'function') return [];
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return (provider as any).listRecent(storeId, cappedLimit);
  }
}
