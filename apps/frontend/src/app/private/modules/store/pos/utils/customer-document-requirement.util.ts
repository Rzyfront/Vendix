/**
 * cod-auto-invoicing S4 — document rules of the POS «Nuevo cliente» form.
 *
 * Guests and Consumidor final never have to give a document: a customer
 * without one is saved and the electronic invoice (if any) goes out as
 * Consumidor final. Only the pair is enforced, the same rule as
 * `PosCustomerService.validateCustomerData`: a number needs its type and a
 * type needs its number.
 */
export interface CustomerDocumentRequirement {
  typeRequired: boolean;
  numberRequired: boolean;
}

export function customerDocumentRequirement(
  documentType: string | null | undefined,
  documentNumber: string | null | undefined,
): CustomerDocumentRequirement {
  const hasType = !!documentType?.trim();
  const hasNumber = !!documentNumber?.trim();
  return {
    typeRequired: hasNumber && !hasType,
    numberRequired: hasType,
  };
}

/** Helper text shown under the document when automatic invoicing is on. */
export function customerDocumentHint(autoEmit: boolean): string | null {
  return autoEmit
    ? 'Opcional. Sin documento, la factura electrónica saldrá a Consumidor final.'
    : null;
}
