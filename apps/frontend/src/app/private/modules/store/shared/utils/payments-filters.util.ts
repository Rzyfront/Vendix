import { ParamMap } from '@angular/router';
import { DateRangeFilter } from '../../../../../shared/interfaces/date-range-filter.interface';
import { FilterConfig, FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { TableColumn } from '../../../../../shared/components/table/table.component';
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import {
  PaymentsDatePreset,
  PaymentsGranularity,
  PaymentsReportQuery,
  PaymentState,
  StorePaymentMethodOption,
} from '../interfaces/payments-report.interface';
import {
  dateRangeToQueryParams,
  queryParamsToDateRange,
} from './date-range-params.util';

/** Prefijo de localStorage del set fijado (`+ storeId`; una clave por pantalla si hace falta sufijar). */
export const PAYMENTS_PINNED_PREFIX = 'vendix_payments_filters_';

/** Key del pin "Fijar" en `FilterValues` (`'true'` | `null`); no es filtro activo. */
export const PAYMENTS_PIN_FILTER_KEY = 'pin_filters';

export const PAYMENT_STATES: readonly PaymentState[] = [
  'pending',
  'succeeded',
  'failed',
  'authorized',
  'captured',
  'refunded',
  'partially_refunded',
  'cancelled',
];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  pending: 'Pendiente',
  succeeded: 'Exitoso',
  failed: 'Fallido',
  authorized: 'Autorizado',
  captured: 'Capturado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
  cancelled: 'Cancelado',
};

/**
 * `badgeConfig` para `TableColumn`/ResponsiveDataView: tipo `custom` con colores
 * hex (el fondo/borde se derivan con transparencia).
 */
export const PAYMENT_STATE_BADGE: NonNullable<TableColumn['badgeConfig']> = {
  type: 'custom',
  size: 'sm',
  colorMap: {
    pending: '#d97706',
    succeeded: '#16a34a',
    failed: '#dc2626',
    authorized: '#0284c7',
    captured: '#059669',
    refunded: '#7c3aed',
    partially_refunded: '#9333ea',
    cancelled: '#6b7280',
  },
};

export const PAYMENT_GRANULARITIES: readonly PaymentsGranularity[] = [
  'hour',
  'day',
  'week',
  'month',
  'year',
];

const GRANULARITY_OPTIONS: { value: PaymentsGranularity; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

const DATE_PRESETS: readonly PaymentsDatePreset[] = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'lastYear',
  'custom',
];

/** Estado de filtros de las pantallas de pagos (reporte y analítica). */
export interface PaymentsFilterState {
  date_range: DateRangeFilter;
  state: PaymentState[];
  payment_method_id: number[];
  granularity?: PaymentsGranularity;
  search?: string;
}

/** Rango por defecto (mismo que reportes/analíticas): mes en curso. */
export function defaultPaymentsDateRange(): DateRangeFilter {
  const now = new Date();
  return {
    start_date: toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    end_date: toLocalDateString(now),
    preset: 'thisMonth',
  };
}

export function defaultPaymentsFilterState(
  opts: { withGranularity?: boolean } = {},
): PaymentsFilterState {
  return {
    date_range: defaultPaymentsDateRange(),
    state: [],
    payment_method_id: [],
    ...(opts.withGranularity ? { granularity: 'day' as PaymentsGranularity } : {}),
  };
}

export function buildPaymentsFilterConfigs(
  methods: StorePaymentMethodOption[],
  opts: { withGranularity: boolean },
): FilterConfig[] {
  const configs: FilterConfig[] = [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range',
      showPresets: true,
    },
    {
      key: 'state',
      label: 'Estado',
      type: 'multi-select',
      placeholder: 'Todos los estados',
      options: PAYMENT_STATES.map((s) => ({
        value: s,
        label: PAYMENT_STATE_LABELS[s],
      })),
    },
    {
      key: 'payment_method_id',
      label: 'Método de pago',
      type: 'multi-select',
      placeholder: 'Todos los métodos',
      options: methods.map((m) => ({ value: String(m.id), label: m.label })),
    },
  ];
  if (opts.withGranularity) {
    configs.push({
      key: 'granularity',
      label: 'Agrupar por',
      type: 'select',
      options: GRANULARITY_OPTIONS,
      defaultValue: 'day',
    });
  }
  return configs;
}

// ── Helpers de coerción ──────────────────────────────────────────────────

function asStringArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v) => v !== '');
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

function toStates(values: string[]): PaymentState[] {
  return [
    ...new Set(
      values.filter((v): v is PaymentState =>
        (PAYMENT_STATES as readonly string[]).includes(v),
      ),
    ),
  ];
}

function toIds(values: string[]): number[] {
  return [
    ...new Set(
      values.map(Number).filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

function toGranularity(value: string | null | undefined): PaymentsGranularity | undefined {
  return (PAYMENT_GRANULARITIES as readonly string[]).includes(value ?? '')
    ? (value as PaymentsGranularity)
    : undefined;
}

function splitCsv(raw: string[]): string[] {
  return raw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

// ── FilterValues <-> estado ──────────────────────────────────────────────

/**
 * Convierte lo que emite `<app-options-dropdown>` al estado. Conserva `search`
 * (el buscador vive fuera del dropdown) y el rango actual si el dropdown no
 * trae uno completo.
 */
export function filterValuesToState(
  values: FilterValues,
  current: PaymentsFilterState,
): PaymentsFilterState {
  const start = values['date_range_start'];
  const end = values['date_range_end'];
  const preset = values['date_range_preset'];
  const hasRange = typeof start === 'string' && !!start && typeof end === 'string' && !!end;

  const date_range: DateRangeFilter = hasRange
    ? {
        start_date: start,
        end_date: end,
        preset:
          typeof preset === 'string' &&
          (DATE_PRESETS as readonly string[]).includes(preset)
            ? (preset as PaymentsDatePreset)
            : undefined,
      }
    : current.date_range;

  const next: PaymentsFilterState = {
    date_range,
    state: toStates(asStringArray(values['state'])),
    payment_method_id: toIds(asStringArray(values['payment_method_id'])),
  };
  const granularity = toGranularity(
    typeof values['granularity'] === 'string' ? values['granularity'] : null,
  );
  if (granularity ?? current.granularity) {
    next.granularity = granularity ?? current.granularity;
  }
  if (current.search) next.search = current.search;
  return next;
}

/** Inverso: estado -> `FilterValues` para `[filterValues]` del dropdown. */
export function stateToFilterValues(state: PaymentsFilterState): FilterValues {
  return {
    date_range_start: state.date_range.start_date || null,
    date_range_end: state.date_range.end_date || null,
    date_range_preset: state.date_range.preset ?? null,
    state: [...state.state],
    payment_method_id: state.payment_method_id.map(String),
    granularity: state.granularity ?? null,
  };
}

// ── Estado -> query HTTP ─────────────────────────────────────────────────

export function stateToQuery(
  state: PaymentsFilterState,
  page: number,
  limit: number,
): PaymentsReportQuery {
  const { date_range: range } = state;
  const preset = range.preset;
  const query: PaymentsReportQuery = { page, limit };

  if (preset) query.date_preset = preset;
  // El backend resuelve los presets en la TZ de la tienda; las fechas solo
  // viajan con `custom` (o sin preset).
  if (!preset || preset === 'custom') {
    query.date_preset = 'custom';
    query.date_from = range.start_date;
    query.date_to = range.end_date;
  }
  if (state.state.length) query.state = [...state.state];
  if (state.payment_method_id.length) {
    query.payment_method_id = [...state.payment_method_id];
  }
  if (state.granularity) query.granularity = state.granularity;
  const search = state.search?.trim();
  if (search) query.search = search;
  return query;
}

// ── Estado <-> URL ───────────────────────────────────────────────────────

export function stateToQueryParams(
  state: PaymentsFilterState,
): Record<string, string> {
  const params: Record<string, string> = {
    ...dateRangeToQueryParams(state.date_range),
  };
  if (state.state.length) params['state'] = state.state.join(',');
  if (state.payment_method_id.length) {
    params['payment_method_id'] = state.payment_method_id.join(',');
  }
  if (state.granularity) params['granularity'] = state.granularity;
  const search = state.search?.trim();
  if (search) params['search'] = search;
  return params;
}

/**
 * Patch para `router.navigate(..., { queryParamsHandling: 'merge' })`: igual que
 * {@link stateToQueryParams} pero con `null` en las claves vacías, porque con
 * `merge` una clave omitida CONSERVA su valor viejo (quitar el último estado no
 * limpiaría `?state=`). `null` es lo que Angular interpreta como "borrar".
 */
export function stateToUrlPatch(
  state: PaymentsFilterState,
): Record<string, string | null> {
  return {
    preset: null,
    state: null,
    payment_method_id: null,
    granularity: null,
    search: null,
    ...stateToQueryParams(state),
  };
}

/** Los params que cuentan como "la URL trae filtros" (para decidir restaurar el pin). */
const URL_FILTER_KEYS = [
  'start_date',
  'end_date',
  'preset',
  'state',
  'payment_method_id',
  'search',
] as const;

/** `true` si la URL no trae ningún filtro con contenido (`granularity` no cuenta). */
export function paymentsUrlHasNoFilters(params: ParamMap): boolean {
  return !URL_FILTER_KEYS.some((k) =>
    params.getAll(k).some((v) => v.trim().length > 0),
  );
}

/**
 * URL -> estado. Lo ausente/ inválido cae a los defaults (mes en curso, sin
 * estados ni métodos).
 */
export function queryParamsToState(params: ParamMap): PaymentsFilterState {
  const base = defaultPaymentsFilterState();
  const range = queryParamsToDateRange(params);
  const preset = range?.preset;
  const state: PaymentsFilterState = {
    date_range: range
      ? {
          ...range,
          preset:
            preset && (DATE_PRESETS as readonly string[]).includes(preset)
              ? preset
              : undefined,
        }
      : base.date_range,
    state: toStates(splitCsv(params.getAll('state'))),
    payment_method_id: toIds(splitCsv(params.getAll('payment_method_id'))),
  };
  const granularity = toGranularity(params.get('granularity'));
  if (granularity) state.granularity = granularity;
  const search = params.get('search')?.trim();
  if (search) state.search = search;
  return state;
}

/**
 * Hay filtros que acotan datos: estados, métodos, búsqueda o un período
 * distinto del default (mes en curso). Granularidad y el pin NO cuentan.
 */
export function hasActiveFilters(state: PaymentsFilterState): boolean {
  const preset = state.date_range.preset;
  return (
    state.state.length > 0 ||
    state.payment_method_id.length > 0 ||
    !!state.search?.trim() ||
    preset !== 'thisMonth'
  );
}
