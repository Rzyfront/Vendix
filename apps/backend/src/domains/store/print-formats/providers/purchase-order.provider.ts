import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class PurchaseOrderDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'purchase_order';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const po = await this.prisma.purchase_orders.findFirst({
      where: { id, store_id: storeId },
      include: {
        stores: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
        suppliers: true,
        purchase_order_items: true,
      },
    });

    if (!po) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const store = po.stores || {};
    const supplier = po.suppliers || {};
    const storeAddr = store.addresses?.[0] || {};

    const items = (po.purchase_order_items || []).map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.product_name || 'Ítem de compra',
      variant_sku: it.sku || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_cost || 0),
      unit_price_formatted: `$${Number(it.unit_cost || 0).toLocaleString('es-CO')}`,
      total_price: Number(it.total_cost || (it.quantity * it.unit_cost) || 0),
      total_price_formatted: `$${Number(it.total_cost || (it.quantity * it.unit_cost) || 0).toLocaleString('es-CO')}`,
    }));

    const total = Number(po.total_amount || 0);

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name,
        tax_id: store.organizations?.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1,
        city: storeAddr.city,
      },
      supplier: {
        name: supplier.name || 'Proveedor General',
        tax_id: supplier.tax_id,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
      },
      document: {
        id: po.id,
        number: po.po_number || `OC-${po.id}`,
        date: po.created_at ? new Date(po.created_at).toISOString() : new Date().toISOString(),
        date_formatted: po.created_at ? new Date(po.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        state: po.state,
        state_label: po.state,
        notes: po.notes || undefined,
      },
      items,
      taxes: [],
      totals: {
        subtotal: total,
        subtotal_formatted: `$${total.toLocaleString('es-CO')}`,
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: total,
        grand_total_formatted: `$${total.toLocaleString('es-CO')}`,
      },
    };
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Retail Central',
        legal_name: 'Vendix Distribuciones S.A.S.',
        tax_id: '900.123.456-7',
        phone: '+57 601 345 6789',
        address: 'Carrera 15 # 85-30, Piso 3',
        city: 'Bogotá D.C.',
      },
      supplier: {
        name: 'Distribuidora Textil Colombiana S.A.',
        tax_id: '890.100.200-5',
        phone: '+57 604 444 3322',
        email: 'ventas@textilcol.com',
        address: 'Zona Industrial Belén, Medellín',
      },
      document: {
        id: 401,
        number: 'OC-2026-0031',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'approved',
        state_label: 'Aprobada',
        notes: 'Entregar en bodega central antes del viernes. Pago a 30 días contra factura.',
      },
      items: [
        {
          index: 1,
          product_name: 'Tela Algodón Pima 100% Rollo 50m',
          variant_sku: 'TEL-ALG-PIMA-50M',
          quantity: 10,
          unit_price: 450000,
          unit_price_formatted: '$450.000',
          total_price: 4500000,
          total_price_formatted: '$4.500.000',
        },
        {
          index: 2,
          product_name: 'Hilo Poliéster Cono Industrial 5000m',
          variant_sku: 'HIL-POL-IND-5000',
          quantity: 50,
          unit_price: 18000,
          unit_price_formatted: '$18.000',
          total_price: 900000,
          total_price_formatted: '$900.000',
        },
      ],
      taxes: [],
      totals: {
        subtotal: 5400000,
        subtotal_formatted: '$5.400.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 5400000,
        grand_total_formatted: '$5.400.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de la orden de compra', example: 'OC-2026-001' },
      { token: '{{supplier.name}}', path: 'supplier.name', description: 'Razón social del proveedor', example: 'Textiles S.A.' },
      { token: '{{supplier.tax_id}}', path: 'supplier.tax_id', description: 'NIT del proveedor', example: '890.100.200-5' },
      { token: '{{supplier.address}}', path: 'supplier.address', description: 'Dirección del proveedor', example: 'Zona Industrial Belén, Medellín' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total de la compra', example: '$5.400.000' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Órdenes de compra. La columna `order_number`
   * es la visible al usuario; el id interno es el que recibe `fetchDocumentData`.
   * Orden por `created_at desc` para mantener el orden temporal esperado.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.purchase_orders.findMany({
      where: { store_id: storeId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        order_number: true,
        created_at: true,
        total_amount: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const cop = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
    return rows.map((r) => ({
      id: r.id,
      number: String(r.order_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.total_amount || 0)),
    }));
  }
}
