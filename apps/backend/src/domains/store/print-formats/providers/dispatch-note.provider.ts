import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
// C.2 (CP-pos-exclusive-tax-double-charge, ADR-12) — G-08: la remisión
// declara `money_basis: 'gross'` y propaga el gate fiscal de C.1.
//
// F-101 (2026-09-14, unificación) — este provider era la mitad "sin dinero"
// de los dos rieles de impresión de la remisión. La otra mitad
// (`dispatch-notes/pdf/dispatch-note-pdf.builder.ts`, vivo vía
// `POST /store/dispatch-notes/:id/pdf`) reutiliza AHORA el gate fiscal de
// este mismo resolver (`resolvePrintsVatBreakdownForPrint`) en vez de
// imprimir el IVA sin condición — ver comentario en
// `dispatch-note-pdf.service.ts`. Ambos rieles siguen siendo dos motores de
// render (HTML del gateway vs PDFKit binario: no hay motor html→pdf en el
// stack, sólo pdfkit), pero ya NO pueden divergir en si el papel muestra el
// desglose de IVA.
//
// Corregido en el mismo commit: este provider leía `order.order_items` /
// `order.subtotal_amount` / `order.grand_total` — el snapshot de la ORDEN
// completa, no el de ESTA remisión. Para remisiones parciales (una orden con
// varias remisiones) o sin orden (traslados, recepciones de compra:
// `order_id` es nullable) esto imprimía el total de la orden entera o una
// tabla vacía. Ahora lee `dispatch_note_items` y los totales propios de
// `dispatch_notes` — el mismo snapshot que ya usaba correctamente
// `dispatch-note-pdf.service.ts`.
import { resolvePrintsVatBreakdownForPrint } from '../services/print-vat-breakdown.resolver';

@Injectable()
export class DispatchNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'dispatch_note';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const note = await this.prisma.dispatch_notes.findFirst({
      where: { id, store_id: storeId },
      include: {
        // C.3 (fix 2026-09-14): la relacion real en schema.prisma es
        // `store`/`order` (singular) — `stores`/`orders` (plural, el nombre
        // del modelo/tabla) no existe como campo de include en
        // `dispatch_notes` y Prisma lo rechaza en runtime con
        // PrismaClientValidationError, tumbando CADA render de remision con
        // 500. Compilaba porque `StorePrismaService` no estrecha el tipo de
        // include lo suficiente para que tsc lo atrape.
        store: {
          include: {
            addresses: { take: 1 },
            // C.1 — settings para el gate fiscal
            // `resolvePrintsVatBreakdownForPrint` (misma forma que
            // `FISCAL_DOCUMENT_PRINT_INCLUDE`).
            store_settings: { select: { settings: true } },
            organizations: {
              include: {
                organization_settings: { select: { settings: true } },
              },
            },
          },
        },
        // F-101 — snapshot propio de la remisión (NO de la orden completa):
        // cubre remisiones parciales y notas sin orden (traslado, recepción
        // de compra). Mismo `include` que `dispatch-note-pdf.service.ts`.
        dispatch_note_items: {
          include: {
            product: { select: { id: true, name: true } },
            product_variant: { select: { id: true, sku: true } },
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            phone: true,
            document_number: true,
          },
        },
      },
    });

    if (!note) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const store = note.store || {};
    const org = store.organizations || {};
    const customer = note.customer || ({} as any);
    const storeAddr = store.addresses?.[0] || {};

    let customerAddress = '';
    if (note.customer_address) {
      if (typeof note.customer_address === 'string') {
        customerAddress = note.customer_address;
      } else if (typeof note.customer_address === 'object') {
        const a = note.customer_address as any;
        customerAddress = [a.address_line1, a.address_line2, a.city, a.state_province].filter(Boolean).join(', ');
      }
    }

    // C.7 — corrige la premisa de F-101, que daba las dos columnas por
    // equivalentes. No lo son: el escritor
    // (`dispatch-notes.service.ts:1247/1749`) persiste
    // `total_price = unit_price × cantidad − descuento + tax_amount`, así que
    // `total_price` ya es BRUTO de línea mientras `unit_price` sigue siendo la
    // BASE por unidad. Bajo `money_basis: 'gross'` eso imprimía una fila que
    // no cuadra consigo misma (Precio × Cant. ≠ Total) aunque Σ filas sí
    // cerrara contra el total del documento. El unitario se lleva a bruto
    // prorrateando el impuesto de LÍNEA (`dispatch_note_items.tax_amount` es
    // por línea, igual que `order_item_taxes.tax_amount`); el total NO se
    // recalcula — es el persistido, y es la magnitud que el invariante de
    // suma verifica.
    const items = (note.dispatch_note_items || []).map((it: any, idx: number) => {
      const quantity = Number(it.dispatched_quantity ?? it.ordered_quantity ?? 1) || 1;
      const lineTax = Number(it.tax_amount || 0);
      const baseUnit = Number(it.unit_price || 0);
      const grossUnit =
        Number.isFinite(lineTax) && lineTax !== 0 && quantity > 0
          ? Math.round((baseUnit + lineTax / quantity) * 100) / 100
          : baseUnit;
      return {
        index: idx + 1,
        product_name: it.product?.name || `Producto #${it.product_id}`,
        variant_sku: it.product_variant?.sku || undefined,
        quantity,
        dispatched_qty: Number(it.dispatched_quantity || 0),
        unit_price: grossUnit,
        total_price: Number(it.total_price || 0),
        discount_amount: it.discount_amount ? Number(it.discount_amount) : undefined,
        tax_amount: it.tax_amount ? Number(it.tax_amount) : undefined,
      };
    });

    return {
      store: {
        name: store.name || 'Vendix Logistics',
        legal_name: store.legal_name,
        tax_id: store.organizations?.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1,
        city: storeAddr.city,
      },
      customer: {
        name: (note as any).customer_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Destinatario',
        tax_id: note.customer_tax_id || customer.document_number || undefined,
        phone: (note as any).customer_phone || customer.phone,
        address: customerAddress,
      },
      document: {
        id: note.id,
        number: note.dispatch_number,
        date: note.created_at ? new Date(note.created_at).toISOString() : new Date().toISOString(),
        date_formatted: note.created_at ? new Date(note.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        state: note.state,
        state_label: note.state,
        shipping_carrier: note.carrier_name || undefined,
        shipping_tracking_number: note.tracking_number || undefined,
        notes: note.notes || undefined,
      },
      // C.2 (ADR-12) — G-08: papel comercial, el destinatario ve el bruto.
      money_basis: 'gross',
      prints_vat_breakdown: resolvePrintsVatBreakdownForPrint(org, store),
      items,
      taxes: [],
      // F-101 — totales propios de la remisión (`dispatch_notes.*`), no los
      // de la orden completa: la única fuente correcta para una remisión
      // parcial o sin orden.
      totals: {
        subtotal: Number(note.subtotal_amount || 0),
        subtotal_formatted: `$${Number(note.subtotal_amount || 0).toLocaleString('es-CO')}`,
        discount_total: Number(note.discount_amount || 0),
        discount_total_formatted: `$${Number(note.discount_amount || 0).toLocaleString('es-CO')}`,
        shipping_total: Number(note.shipping_cost || 0),
        shipping_total_formatted: `$${Number(note.shipping_cost || 0).toLocaleString('es-CO')}`,
        tax_total: Number(note.tax_amount || 0),
        tax_total_formatted: `$${Number(note.tax_amount || 0).toLocaleString('es-CO')}`,
        grand_total: Number(note.grand_total || 0),
        grand_total_formatted: `$${Number(note.grand_total || 0).toLocaleString('es-CO')}`,
      },
    };
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Centro de Distribución',
        legal_name: 'Logística Vendix S.A.S.',
        tax_id: '900.111.222-3',
        phone: '+57 601 789 0011',
        address: 'Autopista Medellín Km 3.5, Parque Industrial',
        city: 'Cota, Cundinamarca',
      },
      customer: {
        name: 'Comercializadora Eléctrica del Norte S.A.S.',
        tax_id: '800.999.777-5',
        phone: '+57 320 555 7788',
        address: 'Calle 45 # 28-14, Barrio El Prado, Barranquilla',
      },
      document: {
        id: 301,
        number: 'REM-2026-00452',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'shipped',
        state_label: 'Despachado',
        shipping_carrier: 'Servientrega Express',
        shipping_tracking_number: 'GUIA-889922001',
        notes: 'Entregar en horario de oficina. Solicitar sello y firma.',
      },
      // C.2 (ADR-12) — muestra en `'gross'`, paridad con `fetchDocumentData`.
      money_basis: 'gross',
      prints_vat_breakdown: true,
      items: [
        {
          index: 1,
          product_name: 'Panel LED 60x60cm 40W Luz Blanca',
          variant_sku: 'PAN-LED-60-40W',
          quantity: 20,
          unit_price: 45000,
          total_price: 900000,
        },
        {
          index: 2,
          product_name: 'Cable UTP Categoría 6 Bobina 305m',
          variant_sku: 'CAB-UTP-CAT6-305M',
          quantity: 2,
          unit_price: 320000,
          total_price: 640000,
        },
      ],
      taxes: [],
      totals: {
        subtotal: 1540000,
        subtotal_formatted: '$1.540.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 1540000,
        grand_total_formatted: '$1.540.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de remisión / guía', example: 'REM-0012' },
      { token: '{{document.shipping_carrier}}', path: 'document.shipping_carrier', description: 'Nombre de la transportadora', example: 'Coordinadora' },
      { token: '{{document.shipping_tracking_number}}', path: 'document.shipping_tracking_number', description: 'Número de guía de tracking', example: '77221144' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección de destino de entrega', example: 'Calle 10 # 5-20' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Remisiones: ordenamos por `emission_date`
   * (no `created_at`) porque la columna de emisión es la fecha operativa
   * que el usuario ve en la remisión; `created_at` puede divergir por
   * correcciones posteriores a la emisión.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.dispatch_notes.findMany({
      where: { store_id: storeId },
      orderBy: { emission_date: 'desc' },
      take: limit,
      select: {
        id: true,
        dispatch_number: true,
        emission_date: true,
        grand_total: true,
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
      number: String(r.dispatch_number),
      date_formatted: r.emission_date ? fmt.format(new Date(r.emission_date)) : '',
      total_formatted: cop.format(Number(r.grand_total || 0)),
    }));
  }
}
