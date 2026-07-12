import { View } from 'react-native';
import { FilterDropdown, type FilterDropdownSection } from '@/shared/components/filter-dropdown/filter-dropdown';
import type { PromotionScope, PromotionState, PromotionType } from '@/features/store/types/promotions.types';
import {
  PROMOTION_LABELS,
  PROMOTION_SCOPE_LABEL,
  PROMOTION_STATE_LABEL,
  PROMOTION_TYPE_LABEL,
} from '@/features/store/constants/promotion-labels';

export interface PromotionFiltersValue {
  state?: PromotionState;
  type?: PromotionType;
  scope?: PromotionScope;
}

export interface PromotionFiltersProps {
  value: PromotionFiltersValue;
  onChange: (next: PromotionFiltersValue) => void;
}

/**
 * Filtros múltiples (state, type, scope) para la lista de promociones.
 *
 * Replica el patrón web (`promotion-list.component.ts:239-275`):
 * 3 selects independientes sobre `options-dropdown`. En mobile usamos
 * `FilterDropdown` shared (ya canónico en el repo).
 *
 * Cada sección tiene una opción "Todos" que limpia ese filtro.
 * El "Limpiar filtros" global no se incluye — el botón "Nueva Promocion"
 * abre el modal de creación en lugar de un reset.
 */
export function PromotionFilters({ value, onChange }: PromotionFiltersProps) {
  const stateOptions: FilterDropdownSection = {
    label: PROMOTION_LABELS.filterState,
    options: (Object.keys(PROMOTION_STATE_LABEL) as PromotionState[]).map((s) => ({
      label: PROMOTION_STATE_LABEL[s],
      value: s,
    })),
    onSelect: (v) => onChange({ ...value, state: (v || undefined) as PromotionState | undefined }),
  };

  const typeOptions: FilterDropdownSection = {
    label: PROMOTION_LABELS.filterType,
    options: (Object.keys(PROMOTION_TYPE_LABEL) as PromotionType[]).map((t) => ({
      label: PROMOTION_TYPE_LABEL[t],
      value: t,
    })),
    onSelect: (v) => onChange({ ...value, type: (v || undefined) as PromotionType | undefined }),
  };

  const scopeOptions: FilterDropdownSection = {
    label: PROMOTION_LABELS.filterScope,
    options: (Object.keys(PROMOTION_SCOPE_LABEL) as PromotionScope[]).map((s) => ({
      label: PROMOTION_SCOPE_LABEL[s],
      value: s,
    })),
    onSelect: (v) => onChange({ ...value, scope: (v || undefined) as PromotionScope | undefined }),
  };

  // Determine a single `activeValue` for the FilterDropdown's badge.
  // The FilterDropdown's `activeValue` highlights ONE option; we instead
  // build a dedicated multi-state by stacking sections visually.
  const activeValue = value.state || value.type || value.scope;

  return (
    <View>
      <FilterDropdown
        triggerLabel={PROMOTION_LABELS.title}
        triggerIcon="sliders-horizontal"
        sections={[stateOptions, typeOptions, scopeOptions]}
        activeValue={activeValue}
      />
    </View>
  );
}
