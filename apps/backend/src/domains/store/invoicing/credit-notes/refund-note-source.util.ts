import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';
import {
  type NoteSourceInvoiceSnapshot,
  type NoteSourceItemSnapshot,
  type ResolveNoteSourceOptions,
  resolveNoteSourceLines,
} from './note-source-resolver.util';
import { recalculateNote } from './recalculate-note.util';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { dianLineExtension, toDecimal } from '../utils/dian-money.util';

type NullableNumeric = Prisma.Decimal | string | number | null;

export interface RefundNoteSourceLine extends NoteSourceItemSnapshot {
  financial_source_line?: {
    source_order_item_id: number | null;
    kind: string;
  } | null;
}

export interface RefundNoteSourceInvoice extends NoteSourceInvoiceSnapshot {
  invoice_items: readonly RefundNoteSourceLine[];
}

export interface RefundNoteSnapshot {
  id: number;
  order_id: number;
  shipping_refund: NullableNumeric;
  refund_items: readonly {
    id: number;
    order_item_id: number;
    quantity: NullableNumeric;
    discount_amount: NullableNumeric;
    tax_amount: NullableNumeric;
    refund_amount: NullableNumeric;
  }[];
}

export interface RefundNoteOrderItem {
  id: number;
  product_id: number | null;
  product_variant_id: number | null;
  product_name: string;
  quantity: NullableNumeric;
}

export interface RefundNoteSourceMap {
  refund_item_sources?: readonly {
    refund_item_id: number;
    source_invoice_item_id: number;
  }[];
  shipping_source_invoice_item_id?: number;
}

type RefundWork = {
  refundItem: RefundNoteSnapshot['refund_items'][number];
  source: RefundNoteSourceLine;
  quantity: Prisma.Decimal;
  amount: Prisma.Decimal;
  tax: Prisma.Decimal;
};

type DerivedPrice = { unit_price: Prisma.Decimal; discount_amount: Prisma.Decimal };

const MAX_MONEY = new Prisma.Decimal('9999999999.99');
const MAX_QUANTITY = new Prisma.Decimal('99999999.9999');
const CENT = new Prisma.Decimal('0.01');

/**
 * Converts an order refund into a tax-recalculated note selection and its
 * refund-line bridge. Product/order data is used only to prove lineage; refund
 * amounts are the economic input and fiscal rates come only from the source.
 */
export function deriveRefundNoteSelection(
  calculator: InvoiceCalculatorService,
  source: RefundNoteSourceInvoice,
  refund: RefundNoteSnapshot,
  orderItems: readonly RefundNoteOrderItem[],
  mapping: RefundNoteSourceMap = {},
  options: ResolveNoteSourceOptions = {},
): {
  items: CreateInvoiceNoteItemDto[];
  bridge_rows: Array<{
    refund_item_id: number;
    covered_qty: number;
    covered_amount: Prisma.Decimal;
  }>;
} {
  validateRefundIdentity(refund, source);
  const orderById = uniqueOrderItems(orderItems, source, refund.id);
  const candidatesByRefund = new Map<number, number[]>();
  for (const refundItem of refund.refund_items) {
    const orderItem = orderById.get(refundItem.order_item_id);
    candidatesByRefund.set(
      refundItem.id,
      orderItem ? candidatesForRefundItem(source, orderItem) : [],
    );
  }

  const explicitMappings = validateExplicitMappings(refund, source, mapping);
  const selectedByRefund = new Map<number, number>();
  const unresolved: Array<{
    refund_item_id: number;
    description: string;
    source_candidates: Array<{ source_invoice_item_id: number; description: string }>;
  }> = [];

  for (const refundItem of refund.refund_items) {
    const candidateIds = candidatesByRefund.get(refundItem.id) ?? [];
    const explicitId = explicitMappings.get(refundItem.id);
    if (explicitId !== undefined) {
      if (!candidateIds.includes(explicitId)) {
        throw sourceError(source, refund.id, 'refund_source_mapping_invalid');
      }
      selectedByRefund.set(refundItem.id, explicitId);
      continue;
    }
    if (candidateIds.length === 1) {
      selectedByRefund.set(refundItem.id, candidateIds[0]);
      continue;
    }
    const orderItem = orderById.get(refundItem.order_item_id);
    unresolved.push({
      refund_item_id: refundItem.id,
      description: safeDescription(orderItem?.product_name ?? ''),
      source_candidates: describeCandidates(source, candidateIds),
    });
  }

  const selectedIds = [...selectedByRefund.values()];
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw sourceError(source, refund.id, 'refund_source_mapping_duplicate');
  }

  const shippingAmount = money(refund.shipping_refund, source, refund.id, 'shipping_refund', true);
  const explicitShippingId = mapping.shipping_source_invoice_item_id;
  if (shippingAmount.isZero() && explicitShippingId !== undefined) {
    throw sourceError(source, refund.id, 'refund_shipping_mapping_extra');
  }
  const shippingCandidates = shippingAmount.isZero()
    ? []
    : shippingSourceCandidates(source, new Set(selectedIds));
  let shippingSourceId: number | undefined;
  if (shippingAmount.greaterThan(0)) {
    if (explicitShippingId !== undefined) {
      if (!shippingCandidates.includes(explicitShippingId)) {
        throw sourceError(source, refund.id, 'refund_shipping_mapping_invalid');
      }
      shippingSourceId = explicitShippingId;
    } else if (shippingCandidates.length === 1) {
      shippingSourceId = shippingCandidates[0];
    }
  }

  const shippingNeedsMapping = shippingAmount.greaterThan(0) && shippingSourceId === undefined;
  if (unresolved.length > 0 || shippingNeedsMapping) {
    throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
      reason: 'refund_source_mapping_required',
      refund_id: refund.id,
      parent_invoice_id: source.id,
      refund_item_candidates: unresolved,
      shipping_source_candidates: shippingNeedsMapping
        ? describeCandidates(source, shippingCandidates)
        : [],
    });
  }

  if (explicitShippingId !== undefined && selectedIds.includes(explicitShippingId)) {
    throw sourceError(source, refund.id, 'refund_shipping_mapping_duplicate');
  }
  if (refund.refund_items.length === 0 && shippingAmount.isZero()) {
    throw sourceError(source, refund.id, 'refund_selection_empty');
  }

  const workItems: RefundWork[] = refund.refund_items.map((refundItem) => {
    const sourceItemId = selectedByRefund.get(refundItem.id);
    const sourceItem = source.invoice_items.find((item) => item.id === sourceItemId);
    if (!sourceItem) throw sourceError(source, refund.id, 'refund_source_item_missing');
    const quantity = quantityValue(refundItem.quantity, source, refund.id, refundItem.id);
    const sourceQuantity = decimalValue(sourceItem.quantity, source, refund.id, 'source_quantity', 4, MAX_QUANTITY);
    if (quantity.greaterThan(sourceQuantity)) {
      throw sourceError(source, refund.id, 'refund_quantity_exceeds_source', sourceItem.id);
    }
    const amount = money(refundItem.refund_amount, source, refund.id, 'refund_amount');
    const tax = money(refundItem.tax_amount, source, refund.id, 'refund_tax_amount');
    if (tax.greaterThan(amount)) {
      throw sourceError(source, refund.id, 'refund_tax_exceeds_total', sourceItem.id);
    }
    return { refundItem, source: sourceItem, quantity, amount, tax };
  });

  const workWithShipping = [...workItems];
  let shippingQuantity: Prisma.Decimal | undefined;
  let shippingWork: RefundWork | undefined;
  if (shippingSourceId !== undefined) {
    const shippingSource = source.invoice_items.find((item) => item.id === shippingSourceId);
    if (!shippingSource) throw sourceError(source, refund.id, 'refund_shipping_source_missing');
    const sourceQuantity = decimalValue(shippingSource.quantity, source, refund.id, 'shipping_source_quantity', 4, MAX_QUANTITY);
    const sourceTotal = money(shippingSource.total_amount, source, refund.id, 'shipping_source_total');
    if (sourceTotal.isZero() || shippingAmount.greaterThan(sourceTotal)) {
      throw sourceError(source, refund.id, 'refund_shipping_amount_unreproducible', shippingSource.id);
    }
    shippingQuantity = sourceQuantity
      .times(shippingAmount)
      .dividedBy(sourceTotal)
      .toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
    if (shippingQuantity.isZero()) {
      throw sourceError(source, refund.id, 'refund_shipping_quantity_zero', shippingSource.id);
    }
    shippingWork = {
      refundItem: {
        id: -1,
        order_item_id: -1,
        quantity: shippingQuantity,
        discount_amount: null,
        tax_amount: null,
        refund_amount: shippingAmount,
      },
      source: shippingSource,
      quantity: shippingQuantity,
      amount: shippingAmount,
      tax: new Prisma.Decimal(0),
    };
    workWithShipping.push(shippingWork);
  }

  const seedRequests = workWithShipping.map((work) => ({
    source_invoice_item_id: work.source.id,
    quantity: dtoNumber(work.quantity, source, refund.id, 'quantity'),
    unit_price: dtoNumber(money(work.source.unit_price, source, refund.id, 'source_unit_price'), source, refund.id, 'unit_price'),
    discount_amount: 0,
  } as CreateInvoiceNoteItemDto));
  const seedLines = resolveNoteSourceLines(source, seedRequests, options);
  if (seedLines.length !== workWithShipping.length) {
    throw sourceError(source, refund.id, 'refund_source_line_count_mismatch');
  }

  const derived = workWithShipping.map((work, index) => {
    const seed = seedLines[index];
    if (!seed) throw sourceError(source, refund.id, 'refund_source_line_missing');
    const effectiveInclusive = seed.item.is_inclusive === true || (
      seed.item.is_inclusive !== false &&
      seed.calculator_input.taxes?.some((tax) => tax.is_inclusive === true) === true
    );
    const enteredAmount = work === shippingWork
      ? work.amount
      : effectiveInclusive
        ? work.amount
        : work.amount.minus(work.tax);
    if (enteredAmount.isNegative()) {
      throw sourceError(source, refund.id, 'refund_net_amount_negative', work.source.id);
    }
    return {
      work,
      inclusive: effectiveInclusive,
      enteredAmount,
      seed,
    };
  });

  const requested: CreateInvoiceNoteItemDto[] = [];
  for (const row of derived) {
    const linePrice = derivePrice(row.seed.item.unit_price, row.seed.item.price_unit_quantity, row.work.quantity, row.enteredAmount, source, refund.id, row.work.source.id);
    const dto: CreateInvoiceNoteItemDto = {
      source_invoice_item_id: row.work.source.id,
      quantity: dtoNumber(row.work.quantity, source, refund.id, 'quantity'),
      unit_price: dtoNumber(linePrice.unit_price, source, refund.id, 'unit_price'),
      discount_amount: dtoNumber(linePrice.discount_amount, source, refund.id, 'discount_amount'),
      unit_code: row.seed.item.unit_code,
    };
    requested.push(dto);
  }

  let recalculated: ReturnType<typeof recalculateNote> | undefined;
  // Shipping's tax is not stored on the refund row. Solve its entered amount
  // through the same calculator so frozen source rates, inclusivity and unit
  // divisor—not live order taxes—determine the result.
  if (shippingWork && shippingQuantity) {
    const shippingIndex = workWithShipping.length - 1;
    const row = derived[shippingIndex];
    if (!row) throw sourceError(source, refund.id, 'refund_shipping_line_missing');
    let entered = row.enteredAmount;
    const seen = new Set<string>();
    let closed = false;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const price = derivePrice(row.seed.item.unit_price, row.seed.item.price_unit_quantity, row.work.quantity, entered, source, refund.id, row.work.source.id);
      requested[shippingIndex] = {
        source_invoice_item_id: row.work.source.id,
        quantity: dtoNumber(row.work.quantity, source, refund.id, 'shipping_quantity'),
        unit_price: dtoNumber(price.unit_price, source, refund.id, 'shipping_unit_price'),
        discount_amount: dtoNumber(price.discount_amount, source, refund.id, 'shipping_discount'),
        unit_code: row.seed.item.unit_code,
      };
      const key = entered.toFixed(2);
      if (seen.has(key)) break;
      seen.add(key);
      const trial = calculateSelection(calculator, source, requested, options, refund.id);
      const calculatedShipping = trial.calculated.lines[shippingIndex];
      if (!calculatedShipping) break;
      const actualTotal = new Prisma.Decimal(calculatedShipping.total_amount);
      const difference = shippingAmount.minus(actualTotal);
      if (difference.isZero()) {
        recalculated = trial;
        closed = true;
        break;
      }
      if (row.inclusive) break;
      entered = entered.plus(difference).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      if (entered.isNegative()) break;
    }
    if (!closed) {
      throw sourceError(source, refund.id, 'refund_shipping_amount_unreproducible', shippingWork.source.id);
    }
  }

  recalculated ??= calculateSelection(calculator, source, requested, options, refund.id);
  if (recalculated.calculated.lines.length !== workWithShipping.length) {
    throw sourceError(source, refund.id, 'refund_calculated_line_count_mismatch');
  }
  for (let index = 0; index < workWithShipping.length; index += 1) {
    const work = workWithShipping[index];
    const line = recalculated.calculated.lines[index];
    if (!work || !line) throw sourceError(source, refund.id, 'refund_calculated_line_missing');
    if (work === shippingWork) {
      if (!new Prisma.Decimal(line.total_amount).equals(shippingAmount)) {
        throw sourceError(source, refund.id, 'refund_shipping_amount_unreproducible', work.source.id);
      }
      continue;
    }
    if (
      !new Prisma.Decimal(line.total_amount).equals(work.amount) ||
      !new Prisma.Decimal(line.tax_amount).equals(work.tax)
    ) {
      throw sourceError(source, refund.id, 'refund_snapshot_amount_mismatch', work.source.id);
    }
  }

  const expectedTotal = workItems.reduce((sum, work) => sum.plus(work.amount), shippingAmount);
  if (!new Prisma.Decimal(recalculated.total_amount).equals(expectedTotal)) {
    throw sourceError(source, refund.id, 'refund_total_mismatch');
  }

  return {
    items: requested,
    bridge_rows: workItems.map((work) => ({
      refund_item_id: work.refundItem.id,
      covered_qty: dtoNumber(work.quantity, source, refund.id, 'bridge_quantity'),
      covered_amount: work.amount,
    })),
  };
}

function calculateSelection(
  calculator: InvoiceCalculatorService,
  source: RefundNoteSourceInvoice,
  requested: readonly CreateInvoiceNoteItemDto[],
  options: ResolveNoteSourceOptions,
  refundId: number,
): ReturnType<typeof recalculateNote> {
  try {
    return recalculateNote(calculator, source, requested, options);
  } catch {
    throw sourceError(source, refundId, 'refund_calculation_unreproducible');
  }
}

function derivePrice(
  sourceUnitPrice: Prisma.Decimal,
  divisor: number,
  quantity: Prisma.Decimal,
  enteredAmount: Prisma.Decimal,
  source: RefundNoteSourceInvoice,
  refundId: number,
  sourceItemId: number,
): DerivedPrice {
  if (!Number.isInteger(divisor) || divisor < 1 || quantity.isZero()) {
    throw sourceError(source, refundId, 'refund_price_divisor_invalid', sourceItemId);
  }
  const grossAt = (price: Prisma.Decimal) => new Prisma.Decimal(dianLineExtension({
    quantity: quantity.toString(),
    unit_price: price.toString(),
    discount_amount: '0',
    price_unit_quantity: String(divisor),
  }));
  let unitPrice = sourceUnitPrice;
  let gross = grossAt(unitPrice);
  if (gross.lt(enteredAmount)) {
    const unrounded = enteredAmount.times(divisor).dividedBy(quantity);
    if (!unrounded.isFinite() || unrounded.greaterThan(MAX_MONEY)) {
      throw sourceError(source, refundId, 'refund_unit_price_out_of_range', sourceItemId);
    }
    unitPrice = unrounded.toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      gross = grossAt(unitPrice);
      if (gross.greaterThanOrEqualTo(enteredAmount)) break;
      unitPrice = unitPrice.plus(CENT);
    }
  }
  if (unitPrice.greaterThan(MAX_MONEY) || gross.lt(enteredAmount)) {
    throw sourceError(source, refundId, 'refund_price_not_representable', sourceItemId);
  }
  const discount = gross.minus(enteredAmount);
  if (
    discount.isNegative() ||
    discount.decimalPlaces() > 2 ||
    discount.greaterThan(MAX_MONEY)
  ) {
    throw sourceError(source, refundId, 'refund_discount_not_representable', sourceItemId);
  }
  return { unit_price: unitPrice, discount_amount: discount };
}

function candidatesForRefundItem(
  source: RefundNoteSourceInvoice,
  orderItem: RefundNoteOrderItem,
): number[] {
  const provenance = source.invoice_items.filter(
    (item) => item.financial_source_line?.source_order_item_id === orderItem.id &&
      item.financial_source_line?.kind !== 'shipping',
  );
  if (provenance.length > 0) {
    return provenance
      .filter((item) => coherentProduct(item, orderItem))
      .map((item) => item.id);
  }
  return source.invoice_items
    .filter((item) =>
      item.financial_source_line == null &&
      !isShippingDescription(item.description) &&
      item.product_id === orderItem.product_id &&
      item.product_variant_id === orderItem.product_variant_id &&
      item.description.trim() === orderItem.product_name.trim(),
    )
    .map((item) => item.id);
}

function coherentProduct(sourceItem: RefundNoteSourceLine, orderItem: RefundNoteOrderItem): boolean {
  return sourceItem.product_id === orderItem.product_id &&
    sourceItem.product_variant_id === orderItem.product_variant_id;
}

function shippingSourceCandidates(source: RefundNoteSourceInvoice, occupied: ReadonlySet<number>): number[] {
  const provenance = source.invoice_items.filter(
    (item) => item.financial_source_line?.kind === 'shipping',
  );
  const candidates = provenance.length > 0
    ? provenance
    : source.invoice_items.filter(
        (item) => isShippingDescription(item.description),
      );
  return candidates.filter((item) => !occupied.has(item.id)).map((item) => item.id);
}

function validateExplicitMappings(
  refund: RefundNoteSnapshot,
  source: RefundNoteSourceInvoice,
  mapping: RefundNoteSourceMap,
): Map<number, number> {
  const rows = mapping.refund_item_sources ?? [];
  if (rows.length === 0) return new Map();
  const refundIds = new Set(refund.refund_items.map((item) => item.id));
  const seenRefund = new Set<number>();
  const seenSource = new Set<number>();
  const result = new Map<number, number>();
  for (const row of rows) {
    if (
      !Number.isInteger(row.refund_item_id) ||
      !refundIds.has(row.refund_item_id) ||
      seenRefund.has(row.refund_item_id) ||
      !Number.isInteger(row.source_invoice_item_id) ||
      seenSource.has(row.source_invoice_item_id) ||
      !source.invoice_items.some((item) => item.id === row.source_invoice_item_id)
    ) {
      throw sourceError(source, refund.id, 'refund_source_mapping_invalid');
    }
    seenRefund.add(row.refund_item_id);
    seenSource.add(row.source_invoice_item_id);
    result.set(row.refund_item_id, row.source_invoice_item_id);
  }
  if (seenRefund.size !== refundIds.size) {
    throw sourceError(source, refund.id, 'refund_source_mapping_missing');
  }
  return result;
}

function uniqueOrderItems(
  items: readonly RefundNoteOrderItem[],
  source: RefundNoteSourceInvoice,
  refundId: number,
): Map<number, RefundNoteOrderItem> {
  const result = new Map<number, RefundNoteOrderItem>();
  for (const item of items) {
    if (!Number.isInteger(item.id) || item.id < 1 || result.has(item.id)) {
      throw sourceError(source, refundId, 'refund_order_item_snapshot_invalid');
    }
    result.set(item.id, item);
  }
  return result;
}

function validateRefundIdentity(refund: RefundNoteSnapshot, source: RefundNoteSourceInvoice): void {
  if (
    !Number.isInteger(refund.id) || refund.id < 1 ||
    !Number.isInteger(refund.order_id) || refund.order_id < 1 ||
    !Number.isInteger(source.id) || source.id < 1
  ) {
    throw sourceError(source, refund.id, 'refund_identity_invalid');
  }
  const seen = new Set<number>();
  for (const item of refund.refund_items) {
    if (!Number.isInteger(item.id) || item.id < 1 || seen.has(item.id)) {
      throw sourceError(source, refund.id, 'refund_item_identity_invalid');
    }
    seen.add(item.id);
  }
}

function quantityValue(
  value: NullableNumeric,
  source: RefundNoteSourceInvoice,
  refundId: number,
  refundItemId: number,
): Prisma.Decimal {
  const result = decimalValue(value, source, refundId, 'refund_quantity', 4, MAX_QUANTITY);
  if (result.isZero()) {
    throw sourceError(source, refundId, 'refund_quantity_invalid', undefined, refundItemId);
  }
  return result;
}

function money(
  value: NullableNumeric,
  source: RefundNoteSourceInvoice,
  refundId: number,
  field: string,
  nullAsZero = false,
): Prisma.Decimal {
  if (value === null && nullAsZero) return new Prisma.Decimal(0);
  return decimalValue(value, source, refundId, field, 2, MAX_MONEY);
}

function decimalValue(
  value: NullableNumeric,
  source: RefundNoteSourceInvoice,
  refundId: number,
  field: string,
  scale: 2 | 4,
  max: Prisma.Decimal,
): Prisma.Decimal {
  let result: Prisma.Decimal;
  try {
    if (value === null) throw new Error('null');
    result = toDecimal(value);
  } catch {
    throw sourceError(source, refundId, `refund_${field}_invalid`);
  }
  if (!result.isFinite() || result.isNegative() || result.decimalPlaces() > scale || result.greaterThan(max)) {
    throw sourceError(source, refundId, `refund_${field}_invalid`);
  }
  return result;
}

function dtoNumber(
  value: Prisma.Decimal,
  source: RefundNoteSourceInvoice,
  refundId: number,
  field: string,
): number {
  const numeric = Number(value.toString());
  if (!Number.isFinite(numeric)) throw sourceError(source, refundId, `refund_${field}_invalid`);
  try {
    if (!new Prisma.Decimal(numeric).equals(value)) {
      throw sourceError(source, refundId, `refund_${field}_not_representable`);
    }
  } catch {
    throw sourceError(source, refundId, `refund_${field}_not_representable`);
  }
  return numeric;
}

function describeCandidates(
  source: RefundNoteSourceInvoice,
  ids: readonly number[],
): Array<{ source_invoice_item_id: number; description: string }> {
  return ids.map((id) => {
    const item = source.invoice_items.find((row) => row.id === id);
    return {
      source_invoice_item_id: id,
      description: safeDescription(item?.description ?? ''),
    };
  });
}

function safeDescription(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
}

function isShippingDescription(description: string): boolean {
  return /(?:^|\b)(?:env[ií]o|flete|transporte|shipping|delivery)(?:\b|$)/iu.test(description.trim());
}

function sourceError(
  source: RefundNoteSourceInvoice,
  refundId: number,
  reason: string,
  sourceItemId?: number,
  refundItemId?: number,
): VendixHttpException {
  return new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
    reason,
    refund_id: Number.isInteger(refundId) ? refundId : undefined,
    parent_invoice_id: source.id,
    ...(sourceItemId === undefined ? {} : { source_invoice_item_id: sourceItemId }),
    ...(refundItemId === undefined ? {} : { refund_item_id: refundItemId }),
  });
}
