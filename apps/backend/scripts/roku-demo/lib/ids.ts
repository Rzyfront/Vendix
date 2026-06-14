/**
 * Generators for unique IDs, SKUs, prefixes, and sequence numbers.
 *
 * Patterns:
 *   - SKU: ROKU-{CATEGORY}-{BRAND}-{N} e.g. ROKU-TV-SAM-0001
 *   - Order #: ROKU-{YYYYMMDD}-{NNNN} (per day, sequential)
 *   - Quotation #: COT-{YYYYMMDD}-{NNNN}
 *   - PO #: PO-{YYYYMM}-{NNNN}
 *   - Invoice #: ROKU-{NNNNNN} (sequential, 6 digits, from resolution)
 *   - Dispatch #: DSP-{YYYYMMDD}-{NNNN}
 *   - Booking #: BKG-{YYYYMMDD}-{NNNN}
 *   - Layaway #: LYW-{YYYYMMDD}-{NNNN}
 *   - Payment link id: WL-{random6}
 *   - Payout/transaction refs: TXN-{hex8}
 */

let _sequence = 0;
export function nextSequence(): number {
  return ++_sequence;
}

export function resetSequences(): void {
  _sequence = 0;
}

const dateCode = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

export function sku(category: string, brand: string, n: number): string {
  return `ROKU-${category.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}-${brand.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}-${String(n).padStart(4, '0')}`;
}

export function orderNumber(d: Date, n: number): string {
  return `ROKU-${dateCode(d)}-${String(n).padStart(4, '0')}`;
}

export function quotationNumber(d: Date, n: number): string {
  return `COT-${dateCode(d)}-${String(n).padStart(4, '0')}`;
}

export function purchaseOrderNumber(d: Date, n: number): string {
  return `PO-${dateCode(d).slice(0, 6)}-${String(n).padStart(3, '0')}`;
}

export function invoiceNumber(n: number): string {
  return `ROKU-${String(n).padStart(6, '0')}`;
}

export function dispatchNumber(d: Date, n: number): string {
  return `DSP-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function bookingNumber(d: Date, n: number): string {
  return `BKG-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function layawayNumber(d: Date, n: number): string {
  return `LYW-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function paymentAgreementNumber(d: Date, n: number): string {
  return `PAG-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function employeeCode(orgSlug: string, n: number): string {
  return `${orgSlug.toUpperCase().slice(0, 4)}-EMP-${String(n).padStart(4, '0')}`;
}

export function settlementNumber(d: Date, n: number): string {
  return `LIQ-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function advanceNumber(d: Date, n: number): string {
  return `ADV-${dateCode(d)}-${String(n).padStart(3, '0')}`;
}

export function payrollNumber(d: Date, n: number): string {
  return `PAY-${dateCode(d).slice(0, 6)}-${String(n).padStart(3, '0')}`;
}

export function supplierCode(orgSlug: string, n: number): string {
  return `SUP-${orgSlug.toUpperCase().slice(0, 4)}-${String(n).padStart(3, '0')}`;
}

export function customerCode(orgSlug: string, n: number): string {
  return `CLI-${orgSlug.toUpperCase().slice(0, 4)}-${String(n).padStart(4, '0')}`;
}

export function assetNumber(d: Date, n: number): string {
  return `FA-${dateCode(d).slice(0, 6)}-${String(n).padStart(3, '0')}`;
}

export function budgetCode(year: number, n: number): string {
  return `BGT-${year}-${String(n).padStart(2, '0')}`;
}

export function transactionRef(rng: { uuid: () => string }): string {
  return `TXN-${rng.uuid().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}
