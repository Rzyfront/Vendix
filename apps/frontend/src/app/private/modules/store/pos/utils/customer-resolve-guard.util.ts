/**
 * CP-pos-customer-stale — Short-circuit guard for the unified POS
 * customer resolve flow (QUI-723 find-or-create).
 *
 * Root cause of "sale billed to the first-selected customer": the
 * selector short-circuited whenever a customer was already selected,
 * ignoring a freshly filled form, so the new customer was never
 * resolved nor emitted and the payload kept the stale id.
 *
 * Rule "lo diligenciado manda": short-circuit is allowed ONLY when a
 * customer is selected AND the form carries no identifier at all (no
 * email, no document, no name). Any filled identifier forces a backend
 * resolve so the emitted customer always matches what the cashier typed.
 *
 * Pure function so it can be unit-tested without TestBed / Karma.
 */

export interface CustomerResolveFormIdentifiers {
  hasEmail: boolean;
  hasDocument: boolean;
  hasName: boolean;
}

/**
 * Raw snapshot of the selector form. `documentType` counts as touched even
 * without a number: picking a type signals intent to identify someone, so a
 * type-only draft must never silent-short-circuit to the previous customer —
 * it resolves (and `canResolve` guides the cashier with a toast when the
 * number is still missing).
 */
export interface RawCustomerResolveForm {
  email?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  firstName?: string | null;
}

export function extractFormIdentifiers(
  raw: RawCustomerResolveForm,
): CustomerResolveFormIdentifiers {
  return {
    hasEmail: !!raw.email?.trim(),
    hasDocument: !!(raw.documentType || raw.documentNumber?.trim()),
    hasName: !!raw.firstName?.trim(),
  };
}

export function shouldShortCircuitResolve(
  hasSelectedCustomer: boolean,
  form: CustomerResolveFormIdentifiers,
): boolean {
  if (!hasSelectedCustomer) return false;
  return !(form.hasEmail || form.hasDocument || form.hasName);
}
