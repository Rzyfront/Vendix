import { SaveRequirement } from '../../../../../shared/components/save-requirements-modal/save-requirements.interface';

export interface VariantStockRequirementsInput {
  isEditMode: boolean;
  originalHadVariants: boolean;
  /** Stock base del producto simple antes de pasar a variantes. */
  baselineStock: number;
  /** `track_inventory` del producto. */
  trackInventory: boolean;
  stockTransferMode: 'first' | 'distribute' | 'reset' | null;
  totalVariantStock: number;
}

/**
 * Requisitos de stock para guardar un producto con variantes.
 *
 * Las variantes son opciones vendibles, no unidades de inventario: una variante
 * con 0 unidades es válida (queda agotada) y el backend la acepta. Antes se
 * exigía "al menos 1 unidad" y no se podían crear variantes de un producto sin
 * stock. Lo único que se exige es no perder stock existente: al pasar un
 * producto simple CON inventario y stock base a variantes, ese stock se
 * redistribuye entre ellas. Sin inventario no hay stock que redistribuir.
 */
export function getVariantStockRequirements(
  input: VariantStockRequirementsInput,
): SaveRequirement[] {
  const isTransitioning =
    input.trackInventory &&
    input.isEditMode &&
    !input.originalHadVariants &&
    input.baselineStock > 0;
  if (!isTransitioning) return [];

  const action = {
    label: 'Configurar redistribución',
    kind: 'scroll' as const,
    target: 'variants',
  };

  if (!input.stockTransferMode || input.stockTransferMode === 'reset') {
    return [
      {
        id: 'stock-redistribute',
        label: 'Redistribuir stock base',
        reason:
          "Debes redistribuir el stock base. Elige 'Asignar a una variante' o 'Distribuir'.",
        severity: 'required',
        action,
      },
    ];
  }

  if (input.totalVariantStock !== input.baselineStock) {
    return [
      {
        id: 'stock-misaligned',
        label: 'Totales de stock desalineados',
        reason: `La suma de stock de las variantes (${input.totalVariantStock}) debe igualar el stock base original (${input.baselineStock}).`,
        severity: 'required',
        action,
      },
    ];
  }

  return [];
}
