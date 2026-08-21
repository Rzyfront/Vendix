import { SelectorOption } from '../selector/selector.component';

/**
 * Filter type determines how the filter is rendered and behaves
 *
 * `'date-range'` proyecta `<vendix-date-range-filter>` (preset + rango) dentro
 * del dropdown. A diferencia del resto, NO ocupa una sola key en
 * `FilterValues`: se descompone en tres (`start`, `end`, `preset`) para que el
 * contrato `Record<string, string | string[] | null>` siga siendo plano y el
 * padre no tenga que decodificar JSON embebido en un string.
 */
export type FilterType = 'select' | 'multi-select' | 'date' | 'date-range';

/**
 * Configuration for a single filter in the dropdown
 */
export interface FilterConfig {
  /** Unique key for the filter (e.g., 'state', 'category_id') */
  key: string;
  /** Display label for the filter */
  label: string;
  /** Type of filter control */
  type: FilterType;
  /** Available options for the filter (not required for date type) */
  options?: SelectorOption[];
  /** Placeholder text when no value is selected */
  placeholder?: string;
  /** Whether the filter is disabled */
  disabled?: boolean;
  /** Help text shown below the filter */
  helpText?: string;
  /** Default value to restore when filters are cleared (instead of null) */
  defaultValue?: string | string[];

  // --- Sólo para `type: 'date-range'` ---------------------------------------

  /** Key de `FilterValues` para la fecha inicial. Default: `${key}_start`. */
  startKey?: string;
  /** Key de `FilterValues` para la fecha final. Default: `${key}_end`. */
  endKey?: string;
  /** Key de `FilterValues` para el preset elegido. Default: `${key}_preset`. */
  presetKey?: string;
  /** Muestra el selector de presets (Hoy, Este Mes...). Default: `true`. */
  showPresets?: boolean;
}

/**
 * Action button configuration for the dropdown
 */
export interface DropdownAction {
  /** Display label for the action */
  label: string;
  /** Icon name (Lucide icon) */
  icon: string;
  /** Action identifier emitted when clicked */
  action: string;
  /** Visual variant of the action button */
  variant?: 'primary' | 'outline' | 'destructive';
  /** Whether the action is disabled */
  disabled?: boolean;
}

/**
 * Type for filter values - maps filter keys to their values
 * Single-select filters have string | null values
 * Multi-select filters have string[] values
 */
export type FilterValues = Record<string, string | string[] | null>;
