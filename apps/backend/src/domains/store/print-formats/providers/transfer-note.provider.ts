import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class TransferNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'transfer_note';

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * [print-editor-dsk P8] — `transfer_note` ahora LEE.
   *
   * Origen real: `stock_transfers` (cabecera) + `stock_transfer_items`
   * (líneas) + `inventory_locations` (origen/destino). La columna
   * `store_id` no existe en `stock_transfers` (la transferencia es a nivel
   * de organización), por lo que el filtro de alcance es por
   * `organization_id` derivado de la tienda — al imprimir un traslado
   * intra-organización cualquiera de las dos tiendas origen/destino lo ve.
   *
   * El picker reciente sigue filtrando por `organization_id` (no
   * `store_id`), porque una transferencia entre tiendas de la misma
   * organización debe listarse en AMBAS.
   */
  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid transfer id: ${documentId}`,
      );
    }

    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true, name: true },
    });
    if (!store?.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Store ${storeId} not found`,
      );
    }

    const transfer = await this.prisma.stock_transfers.findFirst({
      where: { id, organization_id: store.organization_id },
      include: {
        stock_transfer_items: {
          include: {
            products: {
              select: { id: true, name: true, sku: true, unit: true },
            },
            product_variants: {
              select: { id: true, sku: true, name: true },
            },
          },
        },
        from_location: { select: { id: true, name: true, code: true } },
        to_location: { select: { id: true, name: true, code: true } },
      },
    });

    if (!transfer) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Stock transfer ${id} not found for store ${storeId}`,
      );
    }

    return {
      store: { name: store.name || '', tax_id: '' },
      document: {
        id: transfer.id,
        number: transfer.transfer_number
          ? String(transfer.transfer_number)
          : `TRANSFER-${transfer.id}`,
        date: transfer.transfer_date
          ? new Date(transfer.transfer_date).toISOString()
          : transfer.created_at
          ? new Date(transfer.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: (transfer.transfer_date || transfer.created_at)
          ? new Date(transfer.transfer_date || transfer.created_at!).toLocaleDateString('es-CO')
          : new Date().toLocaleDateString('es-CO'),
        state: transfer.status,
        state_label: transfer.status,
        origin_location: transfer.from_location?.name || '',
        destination_location: transfer.to_location?.name || '',
        notes: transfer.notes || undefined,
      },
      items: (transfer.stock_transfer_items || []).map((it: any, idx: number) => ({
        index: idx + 1,
        product_name: it.products?.name || '',
        variant_sku: it.product_variants?.sku || it.products?.sku || '',
        quantity: Number(it.quantity || 0),
        unit_price: 0,
        total_price: 0,
        notes: it.notes || undefined,
      })),
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 0,
        grand_total_formatted: '$0',
      },
      custom_variables: {
        origin_location_id: transfer.from_location?.id,
        destination_location_id: transfer.to_location?.id,
        origin_location_code: transfer.from_location?.code || '',
        destination_location_code: transfer.to_location?.code || '',
        completed_date: transfer.completed_date
          ? new Date(transfer.completed_date).toISOString()
          : '',
        approval_status: transfer.approved_at ? 'Aprobado' : 'Pendiente',
      },
    };
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Almacén Principal',
        legal_name: 'Vendix Operaciones S.A.S.',
        tax_id: '900.123.456-7',
        phone: '+57 601 234 5678',
        address: 'Bodega 14, Centro Logístico Calle 80',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 601,
        number: 'TRAS-2026-00088',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'completed',
        state_label: 'Completado',
        origin_location: 'Bodega Central Calle 80',
        destination_location: 'Tienda Unicentro Local 215',
        notes: 'Traslado de mercancía para reposición de inventario de fin de semana.',
      },
      items: [
        {
          index: 1,
          product_name: 'Pantalón Jean Slim Fit Azul Oscuro',
          variant_sku: 'JEA-SLIM-AZU-32',
          quantity: 25,
          unit_price: 89000,
          total_price: 2225000,
        },
        {
          index: 2,
          product_name: 'Chaqueta Impermeable Cortavientos Negra',
          variant_sku: 'CHA-IMP-NEG-L',
          quantity: 15,
          unit_price: 135000,
          total_price: 2025000,
        },
      ],
      taxes: [],
      totals: {
        subtotal: 4250000,
        subtotal_formatted: '$4.250.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 4250000,
        grand_total_formatted: '$4.250.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de la nota de traslado', example: 'TRAS-0088' },
      { token: '{{document.origin_location}}', path: 'document.origin_location', description: 'Ubicación o bodega de origen', example: 'Bodega Central' },
      { token: '{{document.destination_location}}', path: 'document.destination_location', description: 'Ubicación o tienda de destino', example: 'Tienda Norte' },
    ];
  }

  /**
   * [print-editor-dsk P8] — `transfer_note` picker: filtra por
   * `organization_id` (derivado de la tienda) porque el documento vive a
   * nivel de organización, no de tienda. Ordena por `transfer_date desc`
   * (fecha operativa, no `created_at`).
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store?.organization_id) return [];

    const rows = await this.prisma.stock_transfers.findMany({
      where: { organization_id: store.organization_id },
      orderBy: { transfer_date: 'desc' },
      take: limit,
      select: {
        id: true,
        transfer_number: true,
        transfer_date: true,
        created_at: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    return rows.map((r) => ({
      id: r.id,
      number: String(r.transfer_number),
      date_formatted: r.transfer_date
        ? fmt.format(new Date(r.transfer_date))
        : r.created_at
        ? fmt.format(new Date(r.created_at))
        : '',
    }));
  }
}