/**
 * Nombre para mostrar de un cliente/tercero, tolerante a persona JURÍDICA.
 *
 * Un cliente JURIDICA sólo tiene `legal_name` (razón social); el backend
 * rechaza `first_name`/`last_name` para ese `person_type` y los deja en NULL.
 * Varias pantallas construían el nombre concatenando sólo `first_name` +
 * `last_name`, así que un cliente NIT como "ÓPTICA PANORAMA SAS" se veía como
 * "—"/"Sin cliente" aunque el registro estuviera completo.
 *
 * Orden de resolución:
 *   1. `legal_name` (razón social) — cubre JURIDICA y cualquier fila que la
 *      traiga poblada, sin necesidad de leer `person_type`.
 *   2. `first_name` + `last_name` unidos — cubre NATURAL.
 *   3. `fallback` (por defecto "Sin cliente").
 */
export interface CustomerNameLike {
  legal_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export const DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK = 'Sin cliente';

export function customerDisplayName(
  customer: CustomerNameLike | null | undefined,
  fallback: string = DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK,
): string {
  if (!customer) return fallback;

  const legalName = customer.legal_name?.trim();
  if (legalName) return legalName;

  const parts = [customer.first_name, customer.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  if (parts.length > 0) return parts.join(' ');

  return fallback;
}
