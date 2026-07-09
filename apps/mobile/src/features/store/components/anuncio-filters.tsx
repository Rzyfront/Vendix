/**
 * AnuncioFilters — Filtro por status para la lista de Anuncios.
 *
 * Replica el `<select>` status del web
 * (`anuncios.component.ts:122-135`) con las 5 opciones: Todos, Borrador,
 * Procesando, Listos, Fallidos. Usa `FilterDropdown` shared.
 *
 * El filtro `format` no se replica en mobile en el MVP porque solo el
 * status es útil para el flow de admin mobile (los format filters pueden
 * agregarse en una iteración futura sin cambiar contrato).
 */

import { View } from 'react-native';

import { FilterDropdown, type FilterDropdownSection } from '@/shared/components/filter-dropdown/filter-dropdown';

import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';
import type { AdCreativeStatus } from '@/features/store/types/anuncios.types';

export interface AnuncioFiltersValue {
  status?: AdCreativeStatus;
}

export interface AnuncioFiltersProps {
  value: AnuncioFiltersValue;
  onChange: (next: AnuncioFiltersValue) => void;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: AdCreativeStatus | ''; label: string }> = [
  { value: '', label: ANUNCIO_LABELS.statusAll },
  { value: 'draft', label: ANUNCIO_LABELS.statusDraft },
  { value: 'processing', label: ANUNCIO_LABELS.statusProcessing },
  { value: 'completed', label: ANUNCIO_LABELS.statusCompleted },
  { value: 'failed', label: ANUNCIO_LABELS.statusFailed },
];

const STATUS_LABEL: Record<AdCreativeStatus, string> = {
  draft: ANUNCIO_LABELS.statusDraft,
  processing: ANUNCIO_LABELS.statusProcessing,
  completed: ANUNCIO_LABELS.statusCompleted,
  failed: ANUNCIO_LABELS.statusFailed,
};

export function AnuncioFilters({ value, onChange }: AnuncioFiltersProps) {
  const statusSection: FilterDropdownSection = {
    label: ANUNCIO_LABELS.filterState,
    options: STATUS_OPTIONS.map((opt) => ({
      label: opt.label,
      value: opt.value,
    })),
    onSelect: (v) =>
      onChange({
        ...value,
        status: v ? ((v || undefined) as AdCreativeStatus | undefined) : undefined,
      }),
  };
  // Touch unused variable to prevent TS6133
  void STATUS_LABEL;

  return (
    <View>
      <FilterDropdown
        triggerLabel={ANUNCIO_LABELS.title}
        triggerIcon="sliders-horizontal"
        sections={[statusSection]}
        activeValue={value.status}
      />
    </View>
  );
}
