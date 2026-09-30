import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { normalizeNit } from '../../../common/utils/nit.util';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;
const MAX_SUPPLIER_LOOKUP = 100;
const MAX_SUPPLIER_CATALOG = 200;
const MAX_PO_LINES = 200;
const MAX_RECEPTIONS = 100;
const MATCHABLE_PO_STATUSES = ['approved', 'partial', 'received'] as const;

export type ReceivedDocumentMatchEvidenceTier = 'strong' | 'review';

export interface ReceivedDocumentMatchCandidateQuery {
  search?: string;
  limit?: number;
}

export interface ReceivedDocumentMatchCandidateLine {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  variant_sku: string | null;
  variant_barcode: string | null;
  quantity_ordered: string;
  quantity_received: string;
  unit_cost: string | null;
  unit_price_net: string | null;
  discount_amount: string | null;
  tax_rate: string | null;
  tax_type: string | null;
  purchase_uom_id: number | null;
  purchase_uom_code: string | null;
  product_purchase_uom_code: string | null;
  taxes: Array<{
    tax_name: string;
    tax_type: string;
    tax_rate: string | null;
    calc_mode: string;
    taxable_amount: string;
    tax_amount: string;
  }>;
  matched_document_item_ids: number[];
  match_reason_codes: string[];
}

export interface ReceivedDocumentMatchCandidate {
  purchase_order_id: number;
  order_number: string;
  status: string;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  order_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  /** POs currently have no currency column, so monetary totals are not currency-verified. */
  currency: null;
  supplier: { id: number; name: string; tax_id: string | null };
  location: {
    id: number;
    name: string;
    store_id: number | null;
    is_central_warehouse: boolean;
  };
  evidence_tier: ReceivedDocumentMatchEvidenceTier;
  reason_codes: string[];
  weak_signals: {
    total_difference: string | null;
    invoice_date_matches_po_date: boolean;
    description_matches: number;
  };
  items: ReceivedDocumentMatchCandidateLine[];
  receptions: Array<{
    id: number;
    received_at: string;
    items: Array<{
      id: number;
      purchase_order_item_id: number;
      quantity_received: string;
      note: string | null;
    }>;
  }>;
}

type SupplierRow = {
  id: number;
  name: string;
  tax_id: string | null;
  store_id: number | null;
};

type SupplierCatalogRow = {
  supplier_sku: string | null;
  product_id: number;
  product_variants: Array<{ id: number; sku: string; barcode: string | null }>;
};

type PurchaseOrderRow = Prisma.purchase_ordersGetPayload<{
  include: {
    suppliers: { select: { id: true; name: true; tax_id: true } };
    location: { select: { id: true; name: true; store_id: true; is_central_warehouse: true } };
    purchase_order_items: {
      take: 1;
      include: {
        products: {
          select: {
            id: true;
            name: true;
            sku: true;
            barcode: true;
            purchase_unit: true;
            purchase_to_stock_factor: true;
            stores: { select: { organization_id: true } };
          };
        };
        product_variants: { select: { id: true; sku: true; barcode: true } };
        purchase_order_item_taxes: {
          select: {
            tax_name: true;
            tax_type: true;
            tax_rate: true;
            calc_mode: true;
            taxable_amount: true;
            tax_amount: true;
          };
        };
      };
    };
    receptions: {
      take: 1;
      select: {
        id: true;
        received_at: true;
        items: { select: { id: true; purchase_order_item_id: true; quantity_received: true; note: true } };
      };
    };
  };
}>;

interface ReceivedDocumentLine {
  id: number;
  external_code: string | null;
  product_id: number | null;
  product_variant_id: number | null;
  description: string;
  quantity: Prisma.Decimal;
  unit_code: string | null;
}

interface UnitOfMeasureRow {
  id: number;
  code: string;
  name: string;
}

@Injectable()
export class ReceivedDocumentMatchCandidatesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly documents: ReceivedDocumentsService,
  ) {}

  async list(
    ctx: ReceivedDocumentsContext,
    documentId: number,
    query: ReceivedDocumentMatchCandidateQuery = {},
  ): Promise<{ candidates: ReceivedDocumentMatchCandidate[]; warnings: string[] }> {
    this.assertPositiveInteger(documentId, 'document_id');
    const limit = this.limit(query.limit);
    const search = this.search(query.search);
    await this.documents.assertContext(ctx);

    const document = await this.prisma.received_documents.findFirst({
      where: {
        id: documentId,
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
        ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
      },
      select: {
        id: true,
        organization_id: true,
        accounting_entity_id: true,
        store_id: true,
        issuer_tax_id: true,
        invoice_number: true,
        issue_date: true,
        currency: true,
        total_amount: true,
        validation_status: true,
        items: {
          select: {
            id: true,
            external_code: true,
            product_id: true,
            product_variant_id: true,
            description: true,
            quantity: true,
            unit_code: true,
          },
          orderBy: { line_number: 'asc' },
          take: MAX_PO_LINES + 1,
        },
      },
    });
    if (!document) throw new NotFoundException('Documento recibido no encontrado.');

    const warnings = new Set<string>();
    const documentLinesTruncated = document.items.length > MAX_PO_LINES;
    if (documentLinesTruncated) warnings.add('DOCUMENT_LINES_LIMIT_REACHED');
    document.items = document.items.slice(0, MAX_PO_LINES);
    if (document.validation_status !== 'valid') warnings.add('DOCUMENT_REQUIRES_REVIEW');
    if (document.currency !== 'COP') warnings.add('DOCUMENT_CURRENCY_NOT_COP');
    warnings.add('PO_CURRENCY_NOT_STORED');
    warnings.add('EXPENSE_MATCH_REQUIRES_MANUAL_SELECTION');

    const issuerNit = normalizeNit(document.issuer_tax_id).number;
    if (!issuerNit) {
      warnings.add('ISSUER_TAX_ID_MISSING');
      return { candidates: [], warnings: [...warnings] };
    }

    const suppliers = await this.findSupplierCandidates(ctx, issuerNit);
    if (suppliers.truncated) {
      warnings.add('SUPPLIER_LOOKUP_LIMIT_REACHED');
      warnings.add('SUPPLIER_MATCH_AMBIGUOUS');
      return { candidates: [], warnings: [...warnings] };
    }
    const exactSuppliers = suppliers.rows.filter(
      (supplier) => normalizeNit(supplier.tax_id).number === issuerNit,
    );
    if (exactSuppliers.length === 0) {
      warnings.add('SUPPLIER_NOT_FOUND');
      return { candidates: [], warnings: [...warnings] };
    }
    if (exactSuppliers.length !== 1) {
      warnings.add('SUPPLIER_MATCH_AMBIGUOUS');
      return { candidates: [], warnings: [...warnings] };
    }
    const supplier = exactSuppliers[0];

    const supplierCatalog = await this.findSupplierCatalog(supplier.id, document.items);
    if (supplierCatalog.truncated) warnings.add('SUPPLIER_CATALOG_LIMIT_REACHED');
    const catalogCodes = this.supplierCatalogCodes(supplierCatalog.rows);
    const storeConstraint = document.store_id == null
      ? undefined
      : {
          location: {
            organization_id: ctx.organization_id,
            OR: [
              { store_id: document.store_id },
              { store_id: null },
            ],
          },
        };
    const searchConstraint = search
      ? {
          OR: [
            { order_number: { contains: search, mode: 'insensitive' as const } },
            { supplier_invoice_number: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const orders = await this.prisma.purchase_orders.findMany({
      where: {
        organization_id: ctx.organization_id,
        supplier_id: supplier.id,
        status: { in: [...MATCHABLE_PO_STATUSES] },
        location: { organization_id: ctx.organization_id },
        ...(storeConstraint ?? {}),
        ...(searchConstraint ? { AND: [searchConstraint] } : {}),
      },
      orderBy: [{ order_date: 'desc' }, { id: 'desc' }],
      take: MAX_LIMIT * 5,
      include: {
        suppliers: { select: { id: true, name: true, tax_id: true } },
        location: { select: { id: true, name: true, store_id: true, is_central_warehouse: true } },
        purchase_order_items: {
          take: MAX_PO_LINES + 1,
          orderBy: { id: 'asc' },
          include: {
            products: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                purchase_unit: true,
                purchase_to_stock_factor: true,
                stores: { select: { organization_id: true } },
              },
            },
            product_variants: { select: { id: true, sku: true, barcode: true } },
            purchase_order_item_taxes: {
              select: {
                tax_name: true,
                tax_type: true,
                tax_rate: true,
                calc_mode: true,
                taxable_amount: true,
                tax_amount: true,
              },
              orderBy: { sequence: 'asc' },
            },
          },
        },
        receptions: {
          take: MAX_RECEPTIONS + 1,
          orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            received_at: true,
            items: {
              select: {
                id: true,
                purchase_order_item_id: true,
                quantity_received: true,
                note: true,
              },
              orderBy: { id: 'asc' },
              take: MAX_PO_LINES + 1,
            },
          },
        },
      },
    });

    if (orders.length === 0) {
      warnings.add('NO_PO_CANDIDATES');
      return { candidates: [], warnings: [...warnings] };
    }

    const purchaseUomIds = [...new Set(orders.flatMap((order) =>
      order.purchase_order_items.flatMap((item) => item.purchase_uom_id == null ? [] : [item.purchase_uom_id]),
    ))];
    const uoms = purchaseUomIds.length === 0
      ? []
      : await this.prisma.units_of_measure.findMany({
          where: { id: { in: purchaseUomIds } },
          select: { id: true, code: true, name: true },
        });
    const uomCodes = new Map<number, string>(uoms.map((uom: UnitOfMeasureRow) => [uom.id, uom.code]));

    const truncatedOrderIds = new Set<number>();
    const safeOrders = orders.map((order) => {
      if (order.purchase_order_items.length > MAX_PO_LINES) warnings.add('PO_LINES_LIMIT_REACHED');
      if (order.receptions.length > MAX_RECEPTIONS) warnings.add('RECEPTIONS_LIMIT_REACHED');
      if (order.receptions.some((reception) => reception.items.length > MAX_PO_LINES)) {
        warnings.add('RECEPTION_ITEMS_LIMIT_REACHED');
      }
      if (order.purchase_order_items.length > MAX_PO_LINES || order.receptions.length > MAX_RECEPTIONS ||
          order.receptions.some((reception) => reception.items.length > MAX_PO_LINES)) {
        truncatedOrderIds.add(order.id);
      }
      const safeItems = order.purchase_order_items.filter((item) => item.products.stores.organization_id === ctx.organization_id);
      if (safeItems.length !== order.purchase_order_items.length) warnings.add('PO_LINE_CROSS_ORGANIZATION_PRODUCT_EXCLUDED');
      return {
        ...order,
        purchase_order_items: safeItems.slice(0, MAX_PO_LINES),
        receptions: order.receptions.slice(0, MAX_RECEPTIONS).map((reception) => ({
          ...reception,
          items: reception.items.slice(0, MAX_PO_LINES),
        })),
      };
    });
    const candidates = safeOrders.map((order) => this.toCandidate(
      order,
      document,
      catalogCodes,
      warnings,
      uomCodes,
      documentLinesTruncated || truncatedOrderIds.has(order.id),
    ));
    const documentLineMatchCounts = new Map<number, number>();
    for (const candidate of candidates) {
      for (const line of candidate.items) {
        const hasExactIdentity = line.match_reason_codes.includes('EXACT_SKU_OR_SUPPLIER_CODE') ||
          line.match_reason_codes.includes('EXACT_PRODUCT_ID');
        if (!hasExactIdentity) continue;
        for (const documentItemId of line.matched_document_item_ids) {
          documentLineMatchCounts.set(documentItemId, (documentLineMatchCounts.get(documentItemId) ?? 0) + 1);
        }
      }
    }
    for (const candidate of candidates) {
      candidate.items = candidate.items.map((line) => {
        const hasExactIdentity = line.match_reason_codes.includes('EXACT_SKU_OR_SUPPLIER_CODE') ||
          line.match_reason_codes.includes('EXACT_PRODUCT_ID');
        const ambiguous = hasExactIdentity && line.matched_document_item_ids.some((id) => (documentLineMatchCounts.get(id) ?? 0) > 1);
        if (!ambiguous) return line;
        const reasons = line.match_reason_codes.filter((code) => code !== 'EXACT_SKU_OR_SUPPLIER_CODE' && code !== 'EXACT_PRODUCT_ID');
        reasons.push('SKU_OR_PRODUCT_MATCH_AMBIGUOUS');
        return { ...line, match_reason_codes: [...new Set(reasons)] };
      });
      if (candidate.items.some((line) => line.match_reason_codes.includes('SKU_OR_PRODUCT_MATCH_AMBIGUOUS'))) {
        candidate.reason_codes = [...new Set([...candidate.reason_codes, 'SKU_OR_PRODUCT_MATCH_AMBIGUOUS'])];
      }
    }
    candidates.sort((left, right) => {
      const leftReference = left.reason_codes.includes('EXACT_SUPPLIER_INVOICE_REFERENCE') ? 1 : 0;
      const rightReference = right.reason_codes.includes('EXACT_SUPPLIER_INVOICE_REFERENCE') ? 1 : 0;
      if (leftReference !== rightReference) return rightReference - leftReference;
      const leftSku = left.items.reduce((sum, item) => sum + item.match_reason_codes.filter((code) => code === 'EXACT_SKU_OR_SUPPLIER_CODE' || code === 'EXACT_PRODUCT_ID').length, 0);
      const rightSku = right.items.reduce((sum, item) => sum + item.match_reason_codes.filter((code) => code === 'EXACT_SKU_OR_SUPPLIER_CODE' || code === 'EXACT_PRODUCT_ID').length, 0);
      if (leftSku !== rightSku) return rightSku - leftSku;
      const leftAmount = left.weak_signals.total_difference == null ? null : new Prisma.Decimal(left.weak_signals.total_difference);
      const rightAmount = right.weak_signals.total_difference == null ? null : new Prisma.Decimal(right.weak_signals.total_difference);
      if (leftAmount && rightAmount && !leftAmount.eq(rightAmount)) return leftAmount.comparedTo(rightAmount);
      return right.purchase_order_id - left.purchase_order_id;
    });

    if (orders.length === MAX_LIMIT * 5) warnings.add('PO_CANDIDATE_SEARCH_LIMIT_REACHED');
    return { candidates: candidates.slice(0, limit), warnings: [...warnings] };
  }

  private async findSupplierCandidates(
    ctx: ReceivedDocumentsContext,
    issuerNit: string,
  ): Promise<{ rows: SupplierRow[]; truncated: boolean }> {
    // Use a fixed-shape tagged query with explicit
    // tenant/store/lifecycle predicates before applying the bounded limit.
    const storeId = ctx.store_id ?? null;
    const rows = await this.prisma.$queryRaw<SupplierRow[]>(Prisma.sql`
      SELECT id, name, tax_id, store_id
      FROM suppliers
      WHERE organization_id = ${ctx.organization_id}
        AND state <> 'archived'
        AND regexp_replace(split_part(tax_id, '-', 1), '[^0-9]', '', 'g') = ${issuerNit}
        AND (${storeId}::integer IS NULL OR store_id = ${storeId} OR store_id IS NULL)
      ORDER BY id ASC
      LIMIT ${MAX_SUPPLIER_LOOKUP + 1}
    `);
    return { rows: rows.slice(0, MAX_SUPPLIER_LOOKUP), truncated: rows.length > MAX_SUPPLIER_LOOKUP };
  }

  private async findSupplierCatalog(
    supplierId: number,
    items: ReceivedDocumentLine[],
  ): Promise<{ rows: SupplierCatalogRow[]; truncated: boolean }> {
    const codes = [...new Set(items.map((item) => this.code(item.external_code)).filter(Boolean))];
    if (codes.length === 0) return { rows: [], truncated: false };
    const rows = await this.prisma.supplier_products.findMany({
      where: {
        supplier_id: supplierId,
        OR: codes.map((code) => ({ supplier_sku: { equals: code, mode: 'insensitive' as const } })),
      },
      select: {
        supplier_sku: true,
        product_id: true,
        product_variants: { select: { id: true, sku: true, barcode: true } },
      },
      orderBy: { id: 'asc' },
      take: MAX_SUPPLIER_CATALOG + 1,
    });
    return { rows: rows.slice(0, MAX_SUPPLIER_CATALOG), truncated: rows.length > MAX_SUPPLIER_CATALOG };
  }

  private supplierCatalogCodes(rows: SupplierCatalogRow[]): Map<string, Set<string>> {
    const codes = new Map<string, Set<string>>();
    const add = (code: string | null | undefined, productId: number, variantId: number | null) => {
      const normalized = this.code(code);
      if (!normalized) return;
      const productKey = `${productId}:${variantId ?? ''}`;
      const owners = codes.get(normalized) ?? new Set<string>();
      owners.add(productKey);
      codes.set(normalized, owners);
    };
    for (const row of rows) {
      add(row.supplier_sku, row.product_id, null);
      for (const variant of row.product_variants) {
        add(variant.sku, row.product_id, variant.id);
        add(variant.barcode, row.product_id, variant.id);
      }
    }
    return codes;
  }

  private toCandidate(
    order: PurchaseOrderRow,
    document: {
      id: number;
      store_id: number | null;
      invoice_number: string | null;
      issue_date: Date | null;
      currency: string;
      total_amount: Prisma.Decimal;
      validation_status: string;
      items: ReceivedDocumentLine[];
    },
    supplierCatalogCodes: Map<string, Set<string>>,
    warnings: Set<string>,
    uomCodes: Map<number, string>,
    documentLinesTruncated: boolean,
  ): ReceivedDocumentMatchCandidate {
    const referenceExact = this.sameText(order.supplier_invoice_number, document.invoice_number);
    const lineMatches = this.matchLines(order.purchase_order_items, document.items, supplierCatalogCodes, uomCodes);
    if (lineMatches.some((line) => line.match_reason_codes.includes('UOM_REQUIRES_REVIEW') || line.match_reason_codes.includes('DOCUMENT_UOM_MISSING'))) {
      warnings.add('UNIT_OF_MEASURE_REQUIRES_REVIEW');
    }
    const reasons = new Set<string>();
    if (referenceExact) reasons.add('EXACT_SUPPLIER_INVOICE_REFERENCE');
    if (lineMatches.some((item) => item.match_reason_codes.includes('EXACT_SKU_OR_SUPPLIER_CODE'))) reasons.add('EXACT_SUPPLIER_OR_PRODUCT_CODE');
    if (lineMatches.some((item) => item.match_reason_codes.includes('EXACT_PRODUCT_ID'))) reasons.add('EXACT_PRODUCT_ID');
    if (this.dateMatches(order.supplier_invoice_date, document.issue_date)) reasons.add('INVOICE_DATE_MATCH');
    else if (this.withinDays(order.order_date, document.issue_date, 30)) reasons.add('ORDER_DATE_NEAR_INVOICE_WEAK');
    const totalDifference = new Prisma.Decimal(order.total_amount).minus(document.total_amount).abs();
    if (totalDifference.lte('0.01')) reasons.add('TOTAL_AMOUNT_MATCH_WEAK');
    else if (document.total_amount.gt(0) && totalDifference.div(document.total_amount).lte('0.05')) reasons.add('TOTAL_AMOUNT_CLOSE_WEAK');

    const centralLocation = order.location.store_id == null;
    if (centralLocation) {
      warnings.add('CENTRAL_LOCATION_REQUIRES_REVIEW');
      reasons.add('CENTRAL_LOCATION_MANUAL_REVIEW');
    }
    if (order.receptions.length === 0) warnings.add('NO_RECEIPT_RECORDED');
    else if (order.purchase_order_items.some((item) => item.quantity_received < item.quantity_ordered)) {
      warnings.add('PARTIAL_RECEIPT');
    }
    const storeMatches = document.store_id == null || order.location.store_id === document.store_id;
    if (!storeMatches) reasons.add('STORE_CONTEXT_MISMATCH');
    if (order.supplier_invoice_number == null) reasons.add('SUPPLIER_INVOICE_REFERENCE_MISSING');
    if (document.validation_status !== 'valid') reasons.add('DOCUMENT_REQUIRES_REVIEW');
    if (document.currency !== 'COP') reasons.add('DOCUMENT_CURRENCY_NOT_COP');
    reasons.add('PO_CURRENCY_NOT_STORED');

    const candidateEvidenceTruncated = documentLinesTruncated ||
      order.purchase_order_items.length >= MAX_PO_LINES ||
      order.receptions.length >= MAX_RECEPTIONS ||
      order.receptions.some((reception) => reception.items.length >= MAX_PO_LINES);
    if (candidateEvidenceTruncated) reasons.add('MATCH_EVIDENCE_TRUNCATED_REQUIRES_REVIEW');
    const strong = referenceExact && storeMatches && !centralLocation && document.validation_status === 'valid' &&
      document.currency === 'COP' && !candidateEvidenceTruncated;
    return {
      purchase_order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      supplier_invoice_number: order.supplier_invoice_number,
      supplier_invoice_date: this.dateOnly(order.supplier_invoice_date),
      order_date: this.dateOnly(order.order_date),
      expected_date: this.dateOnly(order.expected_date),
      received_date: this.dateOnly(order.received_date),
      subtotal_amount: this.decimalString(order.subtotal_amount),
      tax_amount: this.decimalString(order.tax_amount),
      total_amount: this.decimalString(order.total_amount),
      currency: null,
      supplier: {
        id: order.suppliers.id,
        name: order.suppliers.name,
        tax_id: order.suppliers.tax_id,
      },
      location: {
        id: order.location.id,
        name: order.location.name,
        store_id: order.location.store_id,
        is_central_warehouse: order.location.is_central_warehouse,
      },
      evidence_tier: strong ? 'strong' : 'review',
      reason_codes: [...reasons],
      weak_signals: {
        total_difference: totalDifference.toFixed(2),
        invoice_date_matches_po_date: this.dateMatches(order.supplier_invoice_date, document.issue_date),
        description_matches: lineMatches.filter((line) => line.match_reason_codes.includes('DESCRIPTION_SIMILARITY_WEAK')).length,
      },
      items: lineMatches,
      receptions: order.receptions.map((reception) => ({
        id: reception.id,
        received_at: reception.received_at.toISOString(),
        items: reception.items.map((item) => ({
          id: item.id,
          purchase_order_item_id: item.purchase_order_item_id,
          quantity_received: this.decimalString(item.quantity_received),
          note: item.note,
        })),
      })),
    };
  }

  private matchLines(
    orderLines: PurchaseOrderRow['purchase_order_items'],
    documentLines: ReceivedDocumentLine[],
    catalogCodes: Map<string, Set<string>>,
    uomCodes: Map<number, string>,
  ): ReceivedDocumentMatchCandidateLine[] {
    const codeOwners = new Map<string, Set<number>>();
    const addCode = (value: string | null, lineId: number) => {
      const code = this.code(value);
      if (!code) return;
      const owners = codeOwners.get(code) ?? new Set<number>();
      owners.add(lineId);
      codeOwners.set(code, owners);
    };
    for (const line of orderLines) {
      addCode(line.products.sku, line.id);
      addCode(line.products.barcode, line.id);
      addCode(line.product_variants?.sku ?? null, line.id);
      addCode(line.product_variants?.barcode ?? null, line.id);
    }

    return orderLines.map((line) => {
      const uniqueProductIdMatches = documentLines.flatMap((docLine) => {
        if (docLine.product_id == null || docLine.product_id !== line.product_id) return [];
        if (docLine.product_variant_id != null && docLine.product_variant_id !== line.product_variant_id) return [];
        const siblingMatches = orderLines.filter((sibling) =>
          sibling.product_id === docLine.product_id &&
          (docLine.product_variant_id == null || sibling.product_variant_id === docLine.product_variant_id),
        );
        return siblingMatches.length === 1 && siblingMatches[0].id === line.id ? [docLine] : [];
      });
      const matchingDocLines = documentLines.flatMap((docLine) => {
        const reasons: string[] = [];
        const exactProduct = uniqueProductIdMatches.some((candidate) => candidate.id === docLine.id);
        if (exactProduct) reasons.push('EXACT_PRODUCT_ID');
        const externalCode = this.code(docLine.external_code);
        const directCodeOwners = externalCode ? codeOwners.get(externalCode) : undefined;
        const catalogOwners = externalCode ? catalogCodes.get(externalCode) : undefined;
        const productOwner = `${line.product_id}:${line.product_variant_id ?? ''}`;
        const codeMatch = !!externalCode && (
          (directCodeOwners?.size === 1 && directCodeOwners.has(line.id)) ||
          (catalogOwners?.size === 1 && (
            catalogOwners.has(productOwner) ||
            (line.product_variant_id == null && catalogOwners.has(`${line.product_id}:`))
          ))
        );
        if (codeMatch) reasons.push('EXACT_SKU_OR_SUPPLIER_CODE');
        const descriptionWeak = this.descriptionSimilar(docLine.description, line.products.name);
        if (descriptionWeak) reasons.push('DESCRIPTION_SIMILARITY_WEAK');
        if (!exactProduct && !codeMatch && !descriptionWeak) return [];
        const orderUomCode = line.purchase_uom_id == null
          ? line.products.purchase_unit
          : uomCodes.get(line.purchase_uom_id) ?? line.products.purchase_unit;
        if (!docLine.unit_code) reasons.push('DOCUMENT_UOM_MISSING');
        else if (!this.sameText(docLine.unit_code, orderUomCode)) reasons.push('UOM_REQUIRES_REVIEW');
        return [{ docLine, reasons }];
      });
      const matchCodes = matchingDocLines.flatMap((match) => match.reasons);
      const uom = line.purchase_uom_id == null ? null : uomCodes.get(line.purchase_uom_id) ?? null;
      return {
        id: line.id,
        product_id: line.product_id,
        product_variant_id: line.product_variant_id,
        product_name: line.products.name,
        product_sku: line.products.sku,
        product_barcode: line.products.barcode,
        variant_sku: line.product_variants?.sku ?? null,
        variant_barcode: line.product_variants?.barcode ?? null,
        quantity_ordered: this.decimalString(line.quantity_ordered),
        quantity_received: this.decimalString(line.quantity_received),
        unit_cost: line.unit_cost == null ? null : this.decimalString(line.unit_cost),
        unit_price_net: line.unit_price_net == null ? null : this.decimalString(line.unit_price_net),
        discount_amount: line.discount_amount == null ? null : this.decimalString(line.discount_amount),
        tax_rate: line.tax_rate == null ? null : this.decimalString(line.tax_rate),
        tax_type: line.tax_type ?? null,
        purchase_uom_id: line.purchase_uom_id,
        purchase_uom_code: uom,
        product_purchase_uom_code: line.products.purchase_unit,
        taxes: line.purchase_order_item_taxes.map((tax) => ({
          tax_name: tax.tax_name,
          tax_type: tax.tax_type,
          tax_rate: tax.tax_rate == null ? null : this.decimalString(tax.tax_rate),
          calc_mode: tax.calc_mode,
          taxable_amount: this.decimalString(tax.taxable_amount),
          tax_amount: this.decimalString(tax.tax_amount),
        })),
        matched_document_item_ids: matchingDocLines.map((match) => match.docLine.id),
        match_reason_codes: [...new Set(matchCodes)],
      };
    });
  }

  private sameText(left: string | null | undefined, right: string | null | undefined): boolean {
    return !!left?.trim() && !!right?.trim() && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  }

  private dateMatches(left: Date | null, right: Date | null): boolean {
    return left != null && right != null && left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
  }

  private withinDays(left: Date | null, right: Date | null, maxDays: number): boolean {
    if (!left || !right) return false;
    return Math.abs(left.getTime() - right.getTime()) <= maxDays * 24 * 60 * 60 * 1000;
  }

  private descriptionSimilar(left: string, right: string): boolean {
    const normalize = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2);
    const leftTokens = new Set(normalize(left));
    const rightTokens = new Set(normalize(right));
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;
    const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return overlap > 0 && overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.7;
  }

  private dateOnly(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
  }

  private decimalString(value: Prisma.Decimal | number | null | undefined): string {
    if (value == null) return '0';
    return value instanceof Prisma.Decimal ? value.toString() : new Prisma.Decimal(value).toString();
  }

  private code(value: string | null | undefined): string {
    return value?.trim().toLocaleLowerCase() ?? '';
  }

  private search(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim().length > 100) {
      throw new BadRequestException('search debe tener un máximo de 100 caracteres.');
    }
    return value.trim() || undefined;
  }

  private limit(value: number | undefined): number {
    if (value === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      throw new BadRequestException(`limit debe ser un entero entre 1 y ${MAX_LIMIT}.`);
    }
    return value;
  }

  private assertPositiveInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new BadRequestException(`${field} debe ser un entero positivo.`);
    }
  }
}
