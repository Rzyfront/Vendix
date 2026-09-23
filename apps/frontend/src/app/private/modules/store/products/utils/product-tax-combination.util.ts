/**
 * Espejo de UI de las reglas de combinación de impuestos del backend
 * (`apps/backend/src/domains/store/products/services/product-tax-combination.util.ts`,
 * 400 PROD_TAX_COMBO_001). El backend es la autoridad; esto solo evita que el
 * selector ofrezca combinaciones que el guardado rechazará:
 *
 * - Retenciones (withholding / reteiva / reteica) no se asignan al producto.
 * - Una categoría por tipo de impuesto (tax_type vacío cuenta como IVA).
 * - IVA e INC son excluyentes.
 * - Una categoría con más de una tarifa no es asignable (se sumarían).
 */

export interface TaxComboCategoryLike {
  id: number;
  name?: string;
  tax_type?: string | null;
  tax_rates?: unknown[];
}

const WITHHOLDING_TYPES = ['withholding', 'reteiva', 'reteica'];

const TYPE_LABEL: Record<string, string> = {
  iva: 'IVA',
  inc: 'INC',
  ica: 'ICA',
};

export function effectiveTaxType(tax_type?: string | null): string {
  const t = (tax_type ?? '').trim().toLowerCase();
  return t === '' ? 'iva' : t;
}

/**
 * Motivo por el que `candidate` NO puede añadirse a la selección actual, o
 * `null` si puede. Una categoría ya seleccionada nunca se bloquea (debe
 * poder quitarse).
 */
export function taxCategoryBlockReason(
  candidate: TaxComboCategoryLike,
  selected: TaxComboCategoryLike[],
): string | null {
  if (selected.some((s) => s.id === candidate.id)) return null;

  const type = effectiveTaxType(candidate.tax_type);
  if (WITHHOLDING_TYPES.includes(type)) {
    return 'Las retenciones se calculan en la venta, no se asignan al producto';
  }
  if ((candidate.tax_rates?.length ?? 0) > 1) {
    return 'Esta categoría tiene varias tarifas; deja una sola para poder asignarla';
  }

  const others = selected.filter((s) => s.id !== candidate.id);
  const sameType = others.find((s) => effectiveTaxType(s.tax_type) === type);
  if (sameType) {
    const label = TYPE_LABEL[type] ?? type.toUpperCase();
    return `Ya hay una categoría de ${label} ("${sameType.name ?? sameType.id}"): solo se permite una por tipo`;
  }
  if (type === 'iva' || type === 'inc') {
    const opposite = type === 'iva' ? 'inc' : 'iva';
    const clash = others.find((s) => effectiveTaxType(s.tax_type) === opposite);
    if (clash) {
      return 'IVA e INC son excluyentes: quita el otro para elegir este';
    }
  }
  return null;
}
