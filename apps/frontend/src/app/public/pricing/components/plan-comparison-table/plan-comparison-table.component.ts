import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import {
  AIFeatureValue,
  PublicPlan,
} from '../../services/public-plans.service';
import { FEATURE_LABELS, humanizeFeatureKey } from './feature-labels';

interface ComparisonCell {
  /** 'check' | 'x' | 'value' (number/string/Ilimitado) */
  kind: 'check' | 'x' | 'value' | 'empty';
  display?: string;
}

interface ComparisonRow {
  label: string;
  cells: ComparisonCell[];
  /** Subtle visual grouping (used for AI subgroup headers) */
  isGroupHeader?: boolean;
}

/**
 * Public landing — side-by-side feature comparison of subscription plans.
 *
 * Mobile-first:
 *   - < md  → horizontal scroll with sticky first column (feature name)
 *   - >= md → full width grid table
 *
 * Reads only public-safe fields from PublicPlan; never touches partner_* /
 * cost_* / internal billing data.
 */
@Component({
  selector: 'app-plan-comparison-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CurrencyPipe, ButtonComponent, IconComponent],
  template: `
    <div class="w-full">
      <!-- Mobile hint -->
      <p class="md:hidden text-xs text-[var(--color-text-secondary)] mb-2 px-1">
        Desliza horizontalmente para comparar todos los planes
      </p>

      <div
        class="relative w-full overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-white shadow-sm"
        role="region"
        aria-label="Comparación de planes"
        tabindex="0"
      >
        <table class="min-w-full border-collapse text-sm">
          <!-- Plans header row -->
          <thead>
            <tr class="bg-[var(--color-background)]">
              <th
                scope="col"
                class="sticky left-0 z-20 bg-[var(--color-background)] text-left p-4 align-bottom border-b border-[var(--color-border)] min-w-[160px] md:min-w-[200px]"
              >
                <span class="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold">
                  Plan / Característica
                </span>
              </th>
              @for (plan of plans(); track plan.id) {
                <th
                  scope="col"
                  class="text-center p-4 align-bottom border-b border-[var(--color-border)] min-w-[180px]"
                  [ngClass]="popularHeaderClass(plan)"
                >
                  <div class="flex flex-col items-center gap-1">
                    @if (plan.is_popular) {
                      <span class="inline-block bg-amber-400 text-amber-900 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full mb-1">
                        Más popular
                      </span>
                    }
                    <span class="text-base font-extrabold text-[var(--color-text-primary)]">
                      {{ plan.name }}
                    </span>
                    @if (plan.description) {
                      <span class="text-[11px] text-[var(--color-text-secondary)] font-normal leading-snug max-w-[200px]">
                        {{ plan.description }}
                      </span>
                    }
                  </div>
                </th>
              }
            </tr>
          </thead>

          <tbody>
            <!-- Price row -->
            <tr class="border-b border-[var(--color-border)] hover:bg-gray-50">
              <th
                scope="row"
                class="sticky left-0 z-10 bg-white text-left p-4 font-medium text-[var(--color-text-primary)]"
              >
                Precio
              </th>
              @for (plan of plans(); track plan.id) {
                <td class="text-center p-4" [ngClass]="popularCellClass(plan)">
                  <div class="flex flex-col items-center gap-0.5">
                    <span class="text-2xl font-extrabold text-[var(--color-text-primary)]">
                      {{ asNumber(plan.base_price) | currency:plan.currency:'symbol':'1.0-0' }}
                    </span>
                    <span class="text-[11px] text-[var(--color-text-secondary)]">
                      / {{ cycleSuffix(plan.billing_cycle) }}
                    </span>
                  </div>
                </td>
              }
            </tr>

            <!-- Trial row -->
            @if (anyHasTrial()) {
              <tr class="border-b border-[var(--color-border)] hover:bg-gray-50">
                <th
                  scope="row"
                  class="sticky left-0 z-10 bg-white text-left p-4 font-medium text-[var(--color-text-primary)]"
                >
                  Periodo de prueba
                </th>
                @for (plan of plans(); track plan.id) {
                  <td class="text-center p-4" [ngClass]="popularCellClass(plan)">
                    @if ((plan.trial_days ?? 0) > 0) {
                      <span class="text-sm text-[var(--color-text-primary)]">
                        {{ plan.trial_days }} días
                      </span>
                    } @else {
                      <app-icon name="x" [size]="16" class="text-red-400 inline-block"></app-icon>
                    }
                  </td>
                }
              </tr>
            }

            <!-- Feature rows -->
            @for (row of featureRows(); track row.label) {
              <tr
                class="border-b border-[var(--color-border)] hover:bg-gray-50"
                [class.bg-gray-50]="row.isGroupHeader"
              >
                <th
                  scope="row"
                  class="sticky left-0 z-10 text-left p-4"
                  [ngClass]="rowLabelClass(row)"
                >
                  {{ row.label }}
                </th>
                @for (cell of row.cells; track $index) {
                  <td class="text-center p-4" [ngClass]="popularCellClass(plans()[$index])">
                    @switch (cell.kind) {
                      @case ('check') {
                        <app-icon name="check" [size]="18" class="text-emerald-600 inline-block"></app-icon>
                      }
                      @case ('x') {
                        <app-icon name="x" [size]="16" class="text-red-400 inline-block"></app-icon>
                      }
                      @case ('value') {
                        <span class="text-sm text-[var(--color-text-primary)]">{{ cell.display }}</span>
                      }
                      @default {
                        <span class="text-[var(--color-text-secondary)]">—</span>
                      }
                    }
                  </td>
                }
              </tr>
            }

            <!-- CTA row -->
            <tr>
              <th scope="row" class="sticky left-0 z-10 bg-white p-4">
                <span class="sr-only">Acción</span>
              </th>
              @for (plan of plans(); track plan.id) {
                <td class="p-4 text-center" [ngClass]="popularCellClass(plan)">
                  <app-button
                    [variant]="plan.is_popular ? 'primary' : 'outline'"
                    [fullWidth]="true"
                    (clicked)="select.emit(plan)"
                  >
                    Seleccionar plan
                  </app-button>
                </td>
              }
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class PlanComparisonTableComponent {
  readonly plans = input.required<PublicPlan[]>();
  readonly select = output<PublicPlan>();

  readonly anyHasTrial = computed(() =>
    this.plans().some((p) => (p.trial_days ?? 0) > 0),
  );

  /**
   * Build the union of feature keys across all plans, then for each plan emit
   * a cell describing whether the feature is enabled and its cap (if any).
   *
   * Source of truth = `ai_features` (public-safe subset). When the backend
   * also exposes `feature_matrix` in the future, additional keys (pos, stores,
   * etc.) will surface automatically.
   */
  readonly featureRows = computed<ComparisonRow[]>(() => {
    const plans = this.plans();
    if (plans.length === 0) return [];

    // Collect ai_features keys preserving deterministic order from access.types.ts
    const aiOrder = [
      'text_generation',
      'streaming_chat',
      'conversations',
      'tool_agents',
      'rag_embeddings',
      'async_queue',
    ];

    const seenAiKeys = new Set<string>();
    plans.forEach((p) => {
      const af = p.ai_features ?? {};
      Object.keys(af).forEach((k) => seenAiKeys.add(k));
    });

    const rows: ComparisonRow[] = [];

    if (seenAiKeys.size > 0) {
      rows.push({
        label: 'Funciones de IA',
        cells: plans.map(() => ({ kind: 'empty' } as ComparisonCell)),
        isGroupHeader: true,
      });

      const orderedAiKeys = [
        ...aiOrder.filter((k) => seenAiKeys.has(k)),
        ...Array.from(seenAiKeys).filter((k) => !aiOrder.includes(k)),
      ];

      for (const key of orderedAiKeys) {
        rows.push({
          label: FEATURE_LABELS[key] ?? humanizeFeatureKey(key),
          cells: plans.map((p) => this.toAIEnabledCell(p.ai_features?.[key])),
        });
        const subRows = this.buildAISubRows(key, plans);
        rows.push(...subRows);
      }
    }

    return rows;
  });

  popularHeaderClass(plan: PublicPlan): Record<string, boolean> {
    return {
      'bg-primary-50': !!plan.is_popular,
      'bg-[var(--color-background)]': !plan.is_popular,
    };
  }

  popularCellClass(plan: PublicPlan | undefined): Record<string, boolean> {
    return {
      'bg-primary-50/60': !!plan?.is_popular,
    };
  }

  rowLabelClass(row: ComparisonRow): Record<string, boolean> {
    return {
      'bg-gray-50': !!row.isGroupHeader,
      'bg-white': !row.isGroupHeader,
      'font-semibold': !!row.isGroupHeader,
      'text-[var(--color-text-primary)]': !!row.isGroupHeader,
      'font-medium': !row.isGroupHeader,
      'text-[var(--color-text-secondary)]': !row.isGroupHeader,
      'pl-6': !row.isGroupHeader,
    };
  }

  private toAIEnabledCell(value: AIFeatureValue | undefined): ComparisonCell {
    if (!value) return { kind: 'x' };
    return value.enabled ? { kind: 'check' } : { kind: 'x' };
  }

  /**
   * For each AI feature, render its cap-specific sub-rows (only the fields
   * that are meaningful to that feature, per FEATURE_QUOTA_CONFIG).
   */
  private buildAISubRows(featureKey: string, plans: PublicPlan[]): ComparisonRow[] {
    const subFieldsByFeature: Record<string, Array<{ field: keyof AIFeatureValue; suffix?: string }>> = {
      text_generation: [{ field: 'monthly_tokens_cap', suffix: 'tokens/mes' }],
      streaming_chat: [{ field: 'daily_messages_cap', suffix: 'msj/día' }],
      conversations: [{ field: 'retention_days', suffix: 'días' }],
      tool_agents: [{ field: 'tools_allowed' }],
      rag_embeddings: [{ field: 'indexed_docs_cap', suffix: 'docs' }],
      async_queue: [{ field: 'monthly_jobs_cap', suffix: 'jobs/mes' }],
    };

    const subFields = subFieldsByFeature[featureKey] ?? [];
    return subFields.map((sub) => ({
      label: FEATURE_LABELS[sub.field as string] ?? humanizeFeatureKey(sub.field as string),
      cells: plans.map((p) => this.toCapCell(p.ai_features?.[featureKey], sub.field, sub.suffix)),
    }));
  }

  private toCapCell(
    value: AIFeatureValue | undefined,
    field: keyof AIFeatureValue,
    suffix?: string,
  ): ComparisonCell {
    if (!value || value.enabled === false) {
      return { kind: 'x' };
    }
    const raw = value[field];

    // tools_allowed is a string[]
    if (Array.isArray(raw)) {
      if (raw.length === 0) return { kind: 'x' };
      if (raw.includes('*')) {
        return { kind: 'value', display: 'Todas' };
      }
      return { kind: 'value', display: `${raw.length}` };
    }

    // null / undefined cap on an enabled feature → "Ilimitado"
    if (raw === null || raw === undefined) {
      return { kind: 'value', display: 'Ilimitado' };
    }

    if (typeof raw === 'number') {
      const formatted = this.formatNumber(raw);
      return {
        kind: 'value',
        display: suffix ? `${formatted} ${suffix}` : formatted,
      };
    }

    if (typeof raw === 'string') {
      return { kind: 'value', display: raw };
    }

    return { kind: 'empty' };
  }

  asNumber(value: number | string): number {
    if (typeof value === 'number') return value;
    const n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  cycleSuffix(cycle: string | undefined): string {
    switch (cycle) {
      case 'monthly': return 'mes';
      case 'quarterly': return 'trimestre';
      case 'semiannual': return 'semestre';
      case 'annual':
      case 'yearly':
        return 'año';
      case 'lifetime': return 'pago único';
      default: return cycle ?? '';
    }
  }

  private formatNumber(n: number): string {
    return new Intl.NumberFormat('es-CO').format(n);
  }
}
