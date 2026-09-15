import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
// C.2 (CP-pos-exclusive-tax-double-charge, ADR-12) — G-10: orden de compra
// declara `money_basis: 'taxable_base'` y propaga el gate de C.1.
import { resolvePrintsVatBreakdownForPrint } from '../services/print-vat-breakdown.resolver';

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

    // C.3 (fix 2026-09-14): `purchase_orders` no tiene columna `store_id` ni
    // relacion `stores` — es org-scoped (`organization_id`), enlazada a la
    // tienda solo indirectamente vía `location.store_id`. El
    // `StorePrismaService` ya aplica ese scope automaticamente
    // (`store-prisma.service.ts:475`: `purchase_orders: { location: {
    // store_id: context.store_id } }`), asi que el `where` explicito con
    // `store_id` no solo era invalido para Prisma (rompia con
    // PrismaClientValidationError, 500 en CADA render de OC) sino redundante.
    const po = await this.prisma.purchase_orders.findFirst({
      where: { id },
      include: {
        organizations: {
          include: {
            addresses: { take: 1 },
            // C.1 — settings para el gate fiscal
            // `resolvePrintsVatBreakdownForPrint` (misma forma que
            // `FISCAL_DOCUMENT_PRINT_INCLUDE`).
            organization_settings: { select: { settings: true } },
          },
        },
        suppliers: true,
        purchase_order_items: true,
      },
    });

    if (!po) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const org = po.organizations || ({} as any);
    const supplier = po.suppliers || {};
    const orgAddr = org.addresses?.[0] || {};

    const items = (po.purchase_order_items || []).map((it: any, idx: number) => {
      // C.3 (fix 2026-09-14): la columna real es `quantity_ordered`, no
      // `quantity` — `it.quantity` era siempre `undefined`, así que el
      // fallback `it.quantity * it.unit_cost` daba `NaN` (falsy) y colapsaba
      // a `0` cada vez que `total_cost` viene nulo en BD (135/157 filas de
      // `purchase_order_items` en este ambiente). Con el total de línea en
      // `$0`, Σ(línea) nunca cuadraba contra `Subtotal` — la condición
      // negativa de la invariante de C.3.
      const qty = Number(it.quantity_ordered || 1);
      const unitCost = Number(it.unit_cost || 0);
      // `qty * unitCost` es siempre `number` (nunca nullish) — el `?? 0`
      // final era código muerto que `tsc` marca como TS2881.
      const lineTotal = Number(it.total_cost ?? (qty * unitCost));
      return {
        index: idx + 1,
        product_name: it.product_name || 'Ítem de compra',
        variant_sku: it.sku || undefined,
        quantity: qty,
        unit_price: unitCost,
        unit_price_formatted: `$${unitCost.toLocaleString('es-CO')}`,
        total_price: lineTotal,
        total_price_formatted: `$${lineTotal.toLocaleString('es-CO')}`,
      };
    });

    // C.3 (fix 2026-09-14): `totals` colapsaba TODO a `po.total_amount` —
    // `subtotal` mentia el bruto como si fuera la base gravable (money_basis
    // declara 'taxable_base' pero el numero impreso era el TOTAL, impuesto
    // incluido) y `tax_total` estaba fijo en 0 sin mirar `po.tax_amount`.
    // Con OC #214 real (subtotal_amount=1440.00, tax_amount=273.60,
    // total_amount=2713.60) el papel imprimia "Subtotal: $2.713,6" en vez de
    // "$1.440" — exactamente la clase de defecto que este plan ataca.
    const subtotal = Number(po.subtotal_amount || 0);
    const discount = Number(po.discount_amount || 0);
    const shipping = Number(po.shipping_cost || 0);
    const taxTotal = Number(po.tax_amount || 0);
    const total = Number(po.total_amount || 0);

    return {
      store: {
        name: org.name || 'Vendix',
        legal_name: org.legal_name,
        tax_id: org.tax_id,
        phone: org.phone,
        email: org.email,
        address: orgAddr.address_line1,
        city: orgAddr.city,
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
      // C.2 (ADR-12) — declaración fija de negocio (G-10): orden de compra
      // siempre sobre base gravable; el gate de IVA se resuelve con org/store
      // ya en memoria por el include de C.1.
      money_basis: 'taxable_base',
      // Sin fila `store` propia (la OC es org-scoped), el resolvedor recibe
      // `undefined` como store: si `org.fiscal_scope` no es explicitamente
      // 'ORGANIZATION' el desempate cae a 'STORE' y no hay `store_settings`
      // que leer → fail-closed (`false`), igual que cualquier otro estado
      // fiscal indeterminado.
      prints_vat_breakdown: resolvePrintsVatBreakdownForPrint(org, undefined),
      items,
      taxes: [],
      totals: {
        subtotal,
        subtotal_formatted: `$${subtotal.toLocaleString('es-CO')}`,
        discount_total: discount,
        discount_total_formatted: `$${discount.toLocaleString('es-CO')}`,
        shipping_total: shipping,
        shipping_total_formatted: `$${shipping.toLocaleString('es-CO')}`,
        tax_total: taxTotal,
        tax_total_formatted: `$${taxTotal.toLocaleString('es-CO')}`,
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
      // C.2 (ADR-12) — muestra en `'taxable_base'`, paridad con `fetchDocumentData`.
      money_basis: 'taxable_base',
      prints_vat_breakdown: true,
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
    // C.3 (fix 2026-09-14): mismo defecto que `fetchDocumentData` — no existe
    // columna `store_id` en `purchase_orders`; el scope por tienda ya lo
    // aplica `StorePrismaService` via `location.store_id` (ver arriba).
    const rows = await this.prisma.purchase_orders.findMany({
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
