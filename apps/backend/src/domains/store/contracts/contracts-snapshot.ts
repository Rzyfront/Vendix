/**
 * C.1 (DB-04, ADR-03) — constructores puros del snapshot congelado del
 * contrato y del numero propio por tienda.
 *
 * Viven fuera del servicio para probarse sin base de datos: lo que se
 * congela aca es lo que D.1 copiara a la factura AIU, asi que cada campo
 * que entre o salga de esta forma cambia el documento fiscal.
 */

export interface ContractSnapshotItem {
  product_id: number | null;
  product_variant_id: number | null;
  product_name: string;
  variant_sku: string | null;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_rate: string | null;
  tax_amount_item: string | null;
  total_price: string;
  notes: string | null;
  applied_price_tier_id: number | null;
  applied_price_tier_name_snapshot: string | null;
}

export interface ContractSnapshot {
  frozen_at: string;
  quotation: {
    id: number;
    quotation_number: string;
    destination: string;
    status: string;
    subtotal_amount: string;
    discount_amount: string;
    tax_amount: string;
    grand_total: string;
    valid_until: string | null;
    notes: string | null;
    terms_and_conditions: string | null;
    accepted_at: string | null;
    items: ContractSnapshotItem[];
  };
  profile: {
    profile_id: number;
    version: number;
    config: unknown;
  } | null;
}

/** Decimal de Prisma (o numero/string) a cadena exacta para el JSON. */
function dec(value: unknown): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return String((value as { toString(): string }).toString());
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * Congela la cotizacion (con sus items y totales) y la version vigente del
 * perfil en el momento de crear el contrato. Referencia viva jamas: lo que
 * cambie despues en el perfil o la cotizacion no toca este JSON.
 */
export function buildContractSnapshot(
  quotation: any,
  profile: { id: number; current_version: number; current_config: unknown } | null,
): ContractSnapshot {
  return {
    frozen_at: new Date().toISOString(),
    quotation: {
      id: quotation.id,
      quotation_number: quotation.quotation_number,
      destination: quotation.destination,
      status: quotation.status,
      subtotal_amount: dec(quotation.subtotal_amount),
      discount_amount: dec(quotation.discount_amount),
      tax_amount: dec(quotation.tax_amount),
      grand_total: dec(quotation.grand_total),
      valid_until: quotation.valid_until
        ? new Date(quotation.valid_until).toISOString()
        : null,
      notes: quotation.notes ?? null,
      terms_and_conditions: quotation.terms_and_conditions ?? null,
      accepted_at: quotation.accepted_at
        ? new Date(quotation.accepted_at).toISOString()
        : null,
      items: (quotation.quotation_items ?? []).map((item: any) => ({
        product_id: item.product_id ?? null,
        product_variant_id: item.product_variant_id ?? null,
        product_name: item.product_name,
        variant_sku: item.variant_sku ?? null,
        quantity: item.quantity,
        unit_price: dec(item.unit_price),
        discount_amount: dec(item.discount_amount),
        tax_rate: item.tax_rate == null ? null : dec(item.tax_rate),
        tax_amount_item:
          item.tax_amount_item == null ? null : dec(item.tax_amount_item),
        total_price: dec(item.total_price),
        notes: item.notes ?? null,
        applied_price_tier_id: item.applied_price_tier_id ?? null,
        applied_price_tier_name_snapshot:
          item.applied_price_tier_name_snapshot ?? null,
      })),
    },
    profile: profile
      ? {
          profile_id: profile.id,
          version: profile.current_version,
          config: profile.current_config ?? null,
        }
      : null,
  };
}

/** Prefijo diario del numero de contrato (`CT-YYYYMMDD-`). */
export function contractNumberPrefix(now: Date = new Date()): string {
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `CT-${year}${month}${day}-`;
}

/**
 * Siguiente numero de la serie diaria por tienda. `last_number` es el
 * mayor numero de hoy en esta tienda (o null si no hay). Misma disciplina
 * que `generateQuotationNumber`: secuencia de 4 digitos por dia y tienda.
 */
export function nextContractNumber(
  last_number: string | null,
  prefix: string,
): string {
  let sequence = 1;
  if (last_number && last_number.startsWith(prefix)) {
    const parsed = parseInt(last_number.slice(-4), 10);
    if (Number.isFinite(parsed)) sequence = parsed + 1;
  }
  return `${prefix}${sequence.toString().padStart(4, '0')}`;
}

