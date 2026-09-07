/**
 * Plan "what's included" items — shared normalization + comparison helpers.
 *
 * Canonical shape of `subscription_plans.feature_matrix` is an ARRAY of
 * `PlanIncludedItem`, written by the super-admin plan form and served by
 * `GET /api/public/plans` as `features[]`. The legacy object shape
 * (`{ pos: true, users: { max: 3 } }`) is only normalized on read.
 *
 * Backend mirror: apps/backend/src/domains/superadmin/subscriptions/dto/plan-feature-item.dto.ts
 * (duplicated per app on purpose: `libs/shared-types` is not path-mapped).
 *
 * Pure functions only — no Angular imports, so both public and private
 * surfaces can use them without pulling a module graph.
 */

export interface PlanIncludedItem {
  key: string;
  label: string;
  enabled: boolean;
  is_limited?: boolean;
  value?: string;
  limit?: number | null;
  unit?: string | null;
}

/** Tone of a cell in the public comparison table. */
export type FeatureComparisonTone = 'yes' | 'partial' | 'no';

export interface FeatureComparisonCell {
  tone: FeatureComparisonTone;
  text: string;
}

export interface FeatureComparisonRow {
  key: string;
  label: string;
  cells: FeatureComparisonCell[];
}

export interface FeatureComparison {
  columns: string[];
  rows: FeatureComparisonRow[];
  highlightIndex: number;
}

/** Minimal label map for legacy object-shaped `feature_matrix` rows. Mirrors
 *  FEATURE_HUMAN_LABELS in the backend public plans service. */
const LEGACY_FEATURE_LABELS: Record<string, string> = {
  pos: 'Punto de Venta POS (Online/Offline)',
  ecommerce: 'Tienda Online & Pedidos WhatsApp',
  accounting: 'Facturación Electrónica DIAN',
  inventory: 'Gestión de Inventario en Tiempo Real',
  inventory_advanced: 'Inventario Multi-bodega & Traslados',
  stores: 'Sucursales / Tiendas',
  users: 'Usuarios con Roles',
  support: 'Soporte Técnico',
  integrations: 'Integraciones ERP & API',
};

const LEGACY_SUPPORT_CHANNELS: Record<string, string> = {
  priority: 'Soporte Prioritario WhatsApp',
  dedicated: 'Soporte VIP Dedicado 4h',
};

/**
 * Turns a label into a stable kebab-case key without accents.
 * `taken` receives already-used keys so collisions get a numeric suffix.
 */
export function slugifyFeatureKey(label: string, taken: Iterable<string> = []): string {
  const base =
    (label ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item';

  const used = new Set(taken);
  if (!used.has(base)) return base;

  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function normalizeLegacyEntry(key: string, val: unknown): PlanIncludedItem {
  const label = LEGACY_FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');

  if (typeof val === 'boolean') {
    return { key, label, enabled: val };
  }

  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;

    if ('max' in obj) {
      const max = obj['max'];
      return {
        key,
        label,
        enabled: true,
        is_limited: max !== null && max !== undefined,
        value: max === null || max === undefined ? 'Ilimitado' : String(max),
        limit: typeof max === 'number' ? max : null,
      };
    }

    if ('channel' in obj) {
      const channel = String(obj['channel'] ?? '');
      return {
        key,
        label: LEGACY_SUPPORT_CHANNELS[channel] ?? 'Soporte Estándar',
        enabled: true,
      };
    }
  }

  return { key, label, enabled: true };
}

/**
 * Accepts the array shape (passthrough, cleaned) or the legacy object shape.
 * Drops items without a label and de-duplicates keys.
 */
export function normalizeIncludedItems(raw: unknown): PlanIncludedItem[] {
  const source: PlanIncludedItem[] = Array.isArray(raw)
    ? (raw as unknown[]).map((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        const label = String(item['label'] ?? item['key'] ?? '').trim();
        return {
          key: String(item['key'] ?? '').trim(),
          label,
          enabled: item['enabled'] === undefined ? true : Boolean(item['enabled']),
          is_limited: item['is_limited'] === undefined ? undefined : Boolean(item['is_limited']),
          value:
            item['value'] === undefined || item['value'] === null
              ? undefined
              : String(item['value']),
          limit: typeof item['limit'] === 'number' ? (item['limit'] as number) : null,
          unit: item['unit'] === undefined || item['unit'] === null ? null : String(item['unit']),
        };
      })
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>)
          .filter(
            ([k]) =>
              !k.startsWith('cost_') && !k.startsWith('partner_') && !k.startsWith('internal_'),
          )
          .map(([k, val]) => normalizeLegacyEntry(k, val))
      : [];

  const seen = new Set<string>();
  const out: PlanIncludedItem[] = [];

  for (const item of source) {
    if (!item.label) continue;
    const key = slugifyFeatureKey(item.key || item.label, seen);
    seen.add(key);
    out.push({ ...item, key });
  }

  return out;
}

/** True when the raw value is the legacy object shape and holds at least one entry. */
export function isLegacyFeatureMatrix(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Object.keys(raw as Record<string, unknown>).length > 0
  );
}

function toCell(item: PlanIncludedItem | undefined): FeatureComparisonCell {
  if (!item || !item.enabled) return { tone: 'no', text: '—' };

  if (item.is_limited) {
    const text =
      item.value ??
      (typeof item.limit === 'number' ? `${item.limit}${item.unit ? ` ${item.unit}` : ''}` : null) ??
      'Limitado';
    return { tone: 'partial', text };
  }

  return { tone: 'yes', text: item.value ?? 'Incluido' };
}

interface ComparablePlan {
  name: string;
  is_popular?: boolean;
  features?: PlanIncludedItem[] | null;
}

/**
 * Builds the public comparison table from the plans currently visible.
 * All-or-nothing: returns `null` when there are no plans or any plan has no
 * items, so the caller can fall back to its static table instead of rendering
 * a half-empty one.
 */
export function buildFeatureComparison(plans: ComparablePlan[]): FeatureComparison | null {
  if (!plans?.length) return null;

  const normalized = plans.map((plan) => normalizeIncludedItems(plan.features ?? []));
  if (normalized.some((items) => items.length === 0)) return null;

  // Row order follows the richest plan first, then whatever the others add.
  const order = [...normalized].sort((a, b) => b.length - a.length);
  const rowKeys: string[] = [];
  const labels = new Map<string, string>();

  for (const items of order) {
    for (const item of items) {
      if (!labels.has(item.key)) {
        labels.set(item.key, item.label);
        rowKeys.push(item.key);
      }
    }
  }

  const byKey = normalized.map((items) => new Map(items.map((i) => [i.key, i])));

  return {
    columns: plans.map((plan) => plan.name),
    rows: rowKeys.map((key) => ({
      key,
      label: labels.get(key) ?? key,
      cells: byKey.map((map) => toCell(map.get(key))),
    })),
    highlightIndex: plans.findIndex((plan) => plan.is_popular === true),
  };
}
