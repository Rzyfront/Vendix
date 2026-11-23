/**
 * Buscador de clientes al vender: una línea por establecimiento.
 *
 * Un cliente (p. ej. una razón social) puede tener varias sedes guardadas como
 * direcciones de envío (`addresses`, con `label` = nombre de la sede). En el
 * listado de búsqueda, un cliente con 2+ establecimientos se muestra como una
 * línea por establecimiento; con 0 o 1 se ve como siempre (una sola línea, sin
 * establecimiento). Al elegir una línea, el host adjunta el establecimiento al
 * cliente (`preferred_address_id`) para que el paso de envío lo preseleccione.
 *
 * Si la búsqueda NO coincide con los datos del cliente pero sí con el nombre o
 * la dirección de alguna sede (el backend también busca por nombre de sede),
 * solo se muestran las líneas de esas sedes.
 */
export interface EstablishmentLike {
  id: number;
  label?: string | null;
  address_line1?: string | null;
  city?: string | null;
  is_primary?: boolean | null;
}

export interface CustomerWithEstablishmentsLike {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  legal_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  document_number?: string | null;
  addresses?: EstablishmentLike[] | null;
}

export interface CustomerEstablishmentRow<C extends CustomerWithEstablishmentsLike> {
  /** Clave estable para `@for track`: `<cliente>` o `<cliente>-<sede>`. */
  key: string;
  customer: C;
  /** Sede de la línea; `null` cuando el cliente se ve en una sola línea. */
  establishment: EstablishmentLike | null;
}

/** Cliente elegido junto con el establecimiento de la línea (solo frontend). */
export type CustomerWithPreferredAddress<C> = C & {
  preferred_address_id?: number | null;
};

/** Máximo de líneas visibles en buscadores compactos cuando hay sedes divididas. */
export const MAX_ESTABLISHMENT_ROWS = 5;

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function customerMatches(
  customer: CustomerWithEstablishmentsLike,
  query: string,
): boolean {
  const fullName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ');
  return [
    customer.first_name,
    customer.last_name,
    fullName,
    customer.legal_name,
    customer.name,
    customer.email,
    customer.phone,
    customer.document_number,
  ].some((field) => !!field && normalize(field).includes(query));
}

function establishmentMatches(
  establishment: EstablishmentLike,
  query: string,
): boolean {
  return [establishment.label, establishment.address_line1].some(
    (field) => !!field && normalize(field).includes(query),
  );
}

/**
 * Expande clientes a líneas: 1 por establecimiento si tiene 2+, o 1 línea sin
 * establecimiento. Conserva el orden del backend (clientes y, dentro de cada
 * uno, sedes con la principal primero).
 */
export function buildCustomerEstablishmentRows<
  C extends CustomerWithEstablishmentsLike,
>(customers: readonly C[] | null | undefined, query = ''): CustomerEstablishmentRow<C>[] {
  const q = normalize(query);
  const rows: CustomerEstablishmentRow<C>[] = [];
  for (const customer of customers ?? []) {
    const establishments = (customer.addresses ?? []).filter(
      (a): a is EstablishmentLike => !!a && a.id != null,
    );
    if (establishments.length < 2) {
      rows.push({ key: String(customer.id), customer, establishment: null });
      continue;
    }
    let visible = establishments;
    if (q && !customerMatches(customer, q)) {
      const matching = establishments.filter((e) => establishmentMatches(e, q));
      if (matching.length > 0) visible = matching;
    }
    for (const establishment of visible) {
      rows.push({
        key: `${customer.id}-${establishment.id}`,
        customer,
        establishment,
      });
    }
  }
  return rows;
}

/** `true` cuando alguna línea es de un establecimiento (cliente dividido). */
export function hasEstablishmentRows(
  rows: readonly CustomerEstablishmentRow<CustomerWithEstablishmentsLike>[],
): boolean {
  return rows.some((row) => row.establishment !== null);
}

/** Texto de la sede: "Sede Norte · Cra 7 # 12-30, Bogotá" (sin nombre: solo la dirección). */
export function establishmentSummary(
  establishment: EstablishmentLike | null | undefined,
): string {
  if (!establishment) return '';
  const address = [establishment.address_line1, establishment.city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
  const label = establishment.label?.trim();
  return [label, address].filter(Boolean).join(' · ');
}

/**
 * Cliente a emitir al elegir una línea: con establecimiento lleva
 * `preferred_address_id`; sin él se devuelve tal cual (comportamiento previo).
 */
export function customerFromEstablishmentRow<
  C extends CustomerWithEstablishmentsLike,
>(row: CustomerEstablishmentRow<C>): CustomerWithPreferredAddress<C> {
  if (!row.establishment) return row.customer;
  return { ...row.customer, preferred_address_id: row.establishment.id };
}

/** Establecimiento preferido del cliente, si sigue existiendo en su lista. */
export function preferredEstablishment<E extends EstablishmentLike>(
  customer:
    | { preferred_address_id?: number | null; addresses?: E[] | null }
    | null
    | undefined,
): E | null {
  const id = customer?.preferred_address_id;
  if (id == null) return null;
  return customer?.addresses?.find((a) => a.id === id) ?? null;
}
