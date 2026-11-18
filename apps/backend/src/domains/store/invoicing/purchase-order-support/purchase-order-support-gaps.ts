import {
  resolveIdentificationType,
} from '../validators/customer-fiscal-identity.validator';
import { dateOnlyString, localDateString } from '../../../../common/utils/store-timezone.util';

/**
 * QUI-684 — reglas PURAS del documento soporte generado desde una orden de
 * compra: qué datos faltan y cómo se precarga el borrador. Sin Prisma, sin
 * contexto: el servicio carga los datos y llama aquí.
 */

export type SupportGapTarget = 'supplier' | 'review' | 'purchase_order';

/** Los códigos son contrato de API: el frontend decide a dónde llevar al usuario. */
export type SupportGapCode =
  | 'PO_CANCELLED'
  | 'SUPPLIER_DOCUMENT_TYPE_REQUIRED'
  | 'SUPPLIER_TAX_ID_REQUIRED'
  | 'SUPPLIER_VERIFICATION_DIGIT_REQUIRED'
  | 'SUPPLIER_NAME_REQUIRED'
  | 'SUPPLIER_ADDRESS_REQUIRED'
  | 'SUPPLIER_MUNICIPALITY_REQUIRED'
  | 'ITEMS_REQUIRED'
  | 'ITEM_DESCRIPTION_REQUIRED'
  | 'ITEM_QUANTITY_REQUIRED'
  | 'ITEM_UNIT_PRICE_REQUIRED'
  | 'ISSUE_DATE_REQUIRED'
  | 'PAYMENT_FORM_REQUIRED'
  | 'DUE_DATE_REQUIRED'
  | 'DUE_DATE_BEFORE_ISSUE';

export interface SupportGap {
  code: SupportGapCode;
  field: string;
  label: string;
  target: SupportGapTarget;
}

export interface SupportSupplierAddress {
  address_line1?: string | null;
  city?: string | null;
  municipality_code?: string | null;
}

export interface SupportSupplierData {
  id: number;
  name?: string | null;
  document_type?: string | null;
  tax_id?: string | null;
  verification_digit?: string | null;
  /** Relación única `suppliers.address_id` → `addresses` (objeto, no lista). */
  addresses?: SupportSupplierAddress | null;
}

export interface SupportCandidateItem {
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
}

export interface SupportCandidateDraft {
  issue_date?: string | null;
  due_date?: string | null;
  payment_form?: string | null;
  items?: SupportCandidateItem[] | null;
}

const blank = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '');

/** Dirección fiscal del proveedor (relación única), o null si no tiene. */
export function pickSupplierAddress(
  address: SupportSupplierAddress | null | undefined,
): SupportSupplierAddress | null {
  return address ?? null;
}

export function computeSupportGaps(input: {
  po_status: string;
  supplier: SupportSupplierData;
  draft: SupportCandidateDraft;
}): SupportGap[] {
  const gaps: SupportGap[] = [];
  const { supplier, draft } = input;

  if (input.po_status === 'cancelled') {
    gaps.push({
      code: 'PO_CANCELLED',
      field: 'status',
      label: 'La orden de compra está cancelada',
      target: 'purchase_order',
    });
  }

  if (blank(supplier.document_type)) {
    gaps.push({
      code: 'SUPPLIER_DOCUMENT_TYPE_REQUIRED',
      field: 'supplier.document_type',
      label: 'El proveedor no tiene tipo de documento',
      target: 'supplier',
    });
  }
  if (blank(supplier.tax_id)) {
    gaps.push({
      code: 'SUPPLIER_TAX_ID_REQUIRED',
      field: 'supplier.tax_id',
      label: 'El proveedor no tiene número de documento',
      target: 'supplier',
    });
  }
  if (
    resolveIdentificationType(supplier.document_type)?.code === '31' &&
    blank(supplier.verification_digit)
  ) {
    gaps.push({
      code: 'SUPPLIER_VERIFICATION_DIGIT_REQUIRED',
      field: 'supplier.verification_digit',
      label: 'El proveedor es NIT y no tiene dígito de verificación',
      target: 'supplier',
    });
  }
  if (blank(supplier.name)) {
    gaps.push({
      code: 'SUPPLIER_NAME_REQUIRED',
      field: 'supplier.name',
      label: 'El proveedor no tiene nombre',
      target: 'supplier',
    });
  }
  const address = pickSupplierAddress(supplier.addresses);
  if (blank(address?.address_line1)) {
    gaps.push({
      code: 'SUPPLIER_ADDRESS_REQUIRED',
      field: 'supplier.address_line1',
      label: 'El proveedor no tiene dirección',
      target: 'supplier',
    });
  }
  if (blank(address?.municipality_code)) {
    gaps.push({
      code: 'SUPPLIER_MUNICIPALITY_REQUIRED',
      field: 'supplier.municipality_code',
      label: 'El proveedor no tiene municipio (código DIAN)',
      target: 'supplier',
    });
  }

  const items = draft.items ?? [];
  if (items.length === 0) {
    gaps.push({
      code: 'ITEMS_REQUIRED',
      field: 'items',
      label: 'El documento no tiene ítems',
      target: 'review',
    });
  }
  items.forEach((item, i) => {
    const n = i + 1;
    if (blank(item.description)) {
      gaps.push({
        code: 'ITEM_DESCRIPTION_REQUIRED',
        field: `items[${i}].description`,
        label: `El ítem ${n} no tiene descripción`,
        target: 'review',
      });
    }
    if (!(Number(item.quantity) > 0)) {
      gaps.push({
        code: 'ITEM_QUANTITY_REQUIRED',
        field: `items[${i}].quantity`,
        label: `El ítem ${n} no tiene cantidad mayor a cero`,
        target: 'review',
      });
    }
    if (!(Number(item.unit_price) > 0)) {
      gaps.push({
        code: 'ITEM_UNIT_PRICE_REQUIRED',
        field: `items[${i}].unit_price`,
        label: `El ítem ${n} no tiene valor unitario mayor a cero`,
        target: 'review',
      });
    }
  });

  if (blank(draft.issue_date)) {
    gaps.push({
      code: 'ISSUE_DATE_REQUIRED',
      field: 'issue_date',
      label: 'Falta la fecha de emisión',
      target: 'review',
    });
  }
  if (draft.payment_form !== '1' && draft.payment_form !== '2') {
    gaps.push({
      code: 'PAYMENT_FORM_REQUIRED',
      field: 'payment_form',
      label: 'No se pudo determinar la forma de pago (contado o crédito)',
      target: 'review',
    });
  }
  // Mismas reglas que `InvoicingService.resolveDueDate`, pero ANTES de numerar:
  // allí se descubren después de tomar el consecutivo y cada intento lo gasta.
  if (draft.payment_form === '2' && blank(draft.due_date)) {
    gaps.push({
      code: 'DUE_DATE_REQUIRED',
      field: 'due_date',
      label: 'La compra es a crédito y falta la fecha de vencimiento',
      target: 'review',
    });
  }
  if (
    !blank(draft.due_date) &&
    !blank(draft.issue_date) &&
    String(draft.due_date).slice(0, 10) < String(draft.issue_date).slice(0, 10)
  ) {
    gaps.push({
      code: 'DUE_DATE_BEFORE_ISSUE',
      field: 'due_date',
      label: 'La fecha de vencimiento es anterior a la fecha de emisión',
      target: 'review',
    });
  }
  return gaps;
}

// ─── Prefill ─────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Tipos de impuesto que `CreateInvoiceTaxDto.tax_type` acepta. */
const DOCUMENT_TAX_TYPES = new Set(['iva', 'inc', 'ica']);

export interface SupportPoItemInput {
  product_id?: number | null;
  product_variant_id?: number | null;
  quantity_ordered: number;
  unit_cost?: unknown;
  unit_price_net?: unknown;
  tax_rate?: unknown;
  tax_type?: string | null;
  tax_amount?: unknown;
  products?: { name?: string | null } | null;
  product_variants?: { name?: string | null } | null;
  purchase_order_item_taxes?: Array<{
    tax_name: string;
    tax_rate?: unknown;
    tax_type: string;
    taxable_amount?: unknown;
    tax_amount?: unknown;
  }> | null;
}

export interface SupportPoInput {
  order_number: string;
  shipping_cost?: unknown;
  shipping_cost_allocation?: string | null;
  payment_plan?: string | null;
  payment_status?: string | null;
  payment_due_date?: Date | null;
  payment_schedules?: Array<{ scheduled_date: Date }> | null;
  purchase_order_items: SupportPoItemInput[];
}

export interface SupportDraftItem {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  product_id?: number;
  product_variant_id?: number;
  is_inclusive: boolean;
  taxes?: Array<{
    tax_name: string;
    tax_rate: number;
    tax_type: string;
    taxable_amount?: number;
    tax_amount: number;
  }>;
}

export interface SupportDraft {
  issue_date: string;
  due_date: string | null;
  payment_form: '1' | '2' | null;
  notes: string;
  withholding_amount: number;
  items: SupportDraftItem[];
}

function buildItem(item: SupportPoItemInput): SupportDraftItem {
  const base = item.products?.name?.trim() ?? '';
  const variant = item.product_variants?.name?.trim() ?? '';
  const description = [base, variant].filter(Boolean).join(' - ');
  // `unit_price_net` ya es NETO de impuesto Y de descuento comercial (la OC lo
  // sella así), por eso el descuento de línea no se vuelve a restar.
  const unit_price = num(item.unit_price_net ?? item.unit_cost);

  const rows = (item.purchase_order_item_taxes ?? []).filter((t) =>
    DOCUMENT_TAX_TYPES.has(t.tax_type),
  );
  let taxes: SupportDraftItem['taxes'];
  if (rows.length > 0) {
    taxes = rows.map((t) => ({
      tax_name: t.tax_name,
      tax_rate: num(t.tax_rate),
      tax_type: t.tax_type,
      taxable_amount: num(t.taxable_amount),
      tax_amount: num(t.tax_amount),
    }));
  } else if (
    (item.purchase_order_item_taxes ?? []).length === 0 &&
    num(item.tax_amount) > 0
  ) {
    // Línea legacy sin filas hijas: un solo impuesto desde las columnas viejas.
    const type = DOCUMENT_TAX_TYPES.has(item.tax_type ?? 'iva')
      ? (item.tax_type ?? 'iva')
      : 'iva';
    taxes = [
      {
        tax_name: type.toUpperCase(),
        tax_rate: num(item.tax_rate),
        tax_type: type,
        tax_amount: num(item.tax_amount),
      },
    ];
  }
  const tax_amount =
    Math.round(
      (taxes ?? []).reduce((acc, t) => acc + t.tax_amount, 0) * 100,
    ) / 100;

  return {
    description,
    quantity: num(item.quantity_ordered),
    unit_price,
    discount_amount: 0,
    tax_amount,
    ...(item.product_id != null && { product_id: item.product_id }),
    ...(item.product_variant_id != null && {
      product_variant_id: item.product_variant_id,
    }),
    is_inclusive: false,
    ...(taxes && { taxes }),
  };
}

export function derivePayment(
  po: Pick<
    SupportPoInput,
    'payment_plan' | 'payment_status' | 'payment_due_date' | 'payment_schedules'
  >,
  timezone: string,
): { payment_form: '1' | '2' | null; due_date: string | null } {
  const dueFromHeader = po.payment_due_date
    ? localDateString(po.payment_due_date, timezone)
    : null;
  const schedules = po.payment_schedules ?? [];
  const lastSchedule = schedules.length
    ? dateOnlyString(
        schedules
          .map((s) => s.scheduled_date)
          .sort((a, b) => a.getTime() - b.getTime())[schedules.length - 1],
      )
    : null;

  switch (po.payment_plan) {
    case 'immediate':
      return { payment_form: '1', due_date: null };
    case 'partial':
    case 'deferred':
    case 'installments':
      return { payment_form: '2', due_date: dueFromHeader ?? lastSchedule };
    default:
      if (po.payment_status === 'paid') return { payment_form: '1', due_date: null };
      if (dueFromHeader) return { payment_form: '2', due_date: dueFromHeader };
      return { payment_form: null, due_date: null };
  }
}

export function buildSupportDraft(
  po: SupportPoInput,
  timezone: string,
  now: Date = new Date(),
): SupportDraft {
  const items = po.purchase_order_items.map(buildItem);

  // El flete de la cabecera viaja como línea propia. Prorratearlo NO lo mete
  // en `unit_cost`/`unit_price_net`: queda en `allocated_shipping_amount` y
  // solo se capitaliza al recibir, así que sin esta línea el documento
  // quedaría por debajo de lo que el proveedor cobró.
  const shipping = num(po.shipping_cost);
  if (shipping > 0) {
    items.push({
      description: 'Flete',
      quantity: 1,
      unit_price: shipping,
      discount_amount: 0,
      tax_amount: 0,
      is_inclusive: false,
    });
  }

  const { payment_form, due_date } = derivePayment(po, timezone);
  return {
    issue_date: localDateString(now, timezone),
    due_date,
    payment_form,
    notes: `Orden de compra ${po.order_number}`,
    withholding_amount: 0,
    items,
  };
}

/** `purchase invoice attached` = factura de compra adjunta (informativo, nunca bloquea). */
export function summarizeSupplierInvoice(po: {
  supplier_invoice_number?: string | null;
  supplier_invoice_date?: Date | null;
  attachments?: Array<{
    supplier_invoice_number?: string | null;
    supplier_invoice_date?: Date | null;
  }> | null;
}): {
  has_supplier_invoice: boolean;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  invoice_attachments_count: number;
} {
  const withNumber = (po.attachments ?? []).filter(
    (a) => !blank(a.supplier_invoice_number),
  );
  const number = !blank(po.supplier_invoice_number)
    ? (po.supplier_invoice_number as string)
    : (withNumber[0]?.supplier_invoice_number ?? null);
  const date = !blank(po.supplier_invoice_number)
    ? po.supplier_invoice_date
    : withNumber[0]?.supplier_invoice_date;
  return {
    has_supplier_invoice: number != null,
    supplier_invoice_number: number,
    supplier_invoice_date: date ? dateOnlyString(date) : null,
    invoice_attachments_count: withNumber.length,
  };
}
