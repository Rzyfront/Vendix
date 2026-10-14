import { Component, computed, inject, input } from '@angular/core';
import {
  ActivatePlanCurrentSubscription,
  ActivatePlanCycleOption,
  ActivatePlanGroupOption,
} from '../../interfaces/subscription-admin.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { IconComponent } from '../../../../../../shared/components/index';
import { normalizeIncludedItems } from '../../../../../../shared/utils/plan-features.util';

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  biannual: 'Semestral',
  annual: 'Anual',
  lifetime: 'Vitalicio',
};

/** Etiqueta legible de un ciclo de facturacion. */
export function planCycleLabel(cycle: string | null | undefined): string {
  if (!cycle) return '';
  return CYCLE_LABELS[cycle] ?? cycle;
}

const AI_FEATURE_LABELS: Record<string, string> = {
  text_generation: 'Generación de texto',
  streaming_chat: 'Chat en streaming',
  conversations: 'Conversaciones',
  tool_agents: 'Agentes con herramientas',
  rag_embeddings: 'RAG y embeddings',
  async_queue: 'Jobs IA asíncronos',
  realtime_voice: 'Modo voz de Vexi',
  vex_agent: 'Vex (agente)',
};

interface DetailFeature {
  key: string;
  label: string;
  detail: string;
}

@Component({
  selector: 'app-plan-detail-panel',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (!group()) {
      <div
        class="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary"
      >
        Selecciona un plan para ver el detalle
      </div>
    } @else {
      <div class="rounded-xl border border-border bg-surface p-4 space-y-4">
        <div class="space-y-1">
          <h3 class="text-base font-semibold text-text-primary">{{ group()!.name }}</h3>
          @if (group()!.description) {
            <p class="text-sm text-text-secondary">{{ group()!.description }}</p>
          }
        </div>

        @if (cycle(); as c) {
          <div class="space-y-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              @if (c.is_free_effective) {
                <span class="text-2xl font-semibold text-text-primary">Gratis</span>
              } @else {
                <span class="text-2xl font-semibold text-text-primary">{{ money(c.effective_price) }}</span>
              }
              <span class="text-sm text-text-secondary">{{ cycleLabel(c.billing_cycle) }}</span>
            </div>
            @if (hasBreakdown()) {
              <p class="text-xs text-text-secondary">
                Base {{ money(c.base_price) }} · Margen partner {{ money(c.margin_amount) }} · Recargo
                {{ money(c.fixed_surcharge) }}
              </p>
            }
          </div>
        }

        @if (features().length > 0) {
          <div class="space-y-2">
            <p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Incluye</p>
            <ul class="space-y-1.5">
              @for (f of features(); track f.key) {
                <li class="flex items-start gap-2 text-sm text-text-primary">
                  <app-icon name="check" [size]="16" class="mt-0.5 flex-shrink-0 text-primary"></app-icon>
                  <span>
                    {{ f.label }}
                    @if (f.detail) {
                      <span class="text-text-secondary"> · {{ f.detail }}</span>
                    }
                  </span>
                </li>
              }
            </ul>
          </div>
        }

        @if (aiFeatures().length > 0) {
          <div class="space-y-2">
            <p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Funciones IA</p>
            <div class="flex flex-wrap gap-1.5">
              @for (f of aiFeatures(); track f.key) {
                <span
                  class="px-2 py-1 text-xs rounded-md border border-border bg-background text-text-secondary"
                >
                  {{ f.label }}
                </span>
              }
            </div>
          </div>
        }

        @if (hasGrace()) {
          <p class="text-xs text-text-secondary">
            Gracia blanda: {{ graceText(group()!.grace_period_soft_days) }} · Gracia dura:
            {{ graceText(group()!.grace_period_hard_days) }}
          </p>
        }

        @if (current()?.plan_name; as planName) {
          <p class="text-xs text-text-secondary border-t border-border pt-3">
            Plan actual de la tienda: {{ planName }}
          </p>
        }
      </div>
    }
  `,
})
export class PlanDetailPanelComponent {
  private readonly currencyService = inject(CurrencyFormatService);

  readonly group = input<ActivatePlanGroupOption | null>(null);
  readonly cycle = input<ActivatePlanCycleOption | null>(null);
  readonly current = input<ActivatePlanCurrentSubscription | null>(null);

  readonly hasBreakdown = computed(() => {
    const c = this.cycle();
    if (!c) return false;
    return (Number(c.margin_amount) || 0) > 0 || (Number(c.fixed_surcharge) || 0) > 0;
  });

  readonly features = computed<DetailFeature[]>(() => {
    const raw = this.group()?.feature_matrix;
    return normalizeIncludedItems(raw)
      .filter((item) => item.enabled && item.label)
      .map((item, i) => {
        let detail = '';
        if (item.value) {
          detail = item.value;
        } else if (item.limit !== null && item.limit !== undefined) {
          detail = item.unit ? `${item.limit} ${item.unit}` : String(item.limit);
        }
        return { key: `${item.key || 'item'}-${i}`, label: item.label, detail };
      });
  });

  readonly aiFeatures = computed<{ key: string; label: string }[]>(() => {
    const flags = this.group()?.ai_feature_flags;
    if (!flags || typeof flags !== 'object') return [];
    return Object.entries(flags as Record<string, unknown>)
      .filter(([, cfg]) => !!cfg && typeof cfg === 'object' && (cfg as { enabled?: unknown }).enabled === true)
      .map(([key]) => ({ key, label: AI_FEATURE_LABELS[key] ?? key }));
  });

  readonly hasGrace = computed(() => {
    const g = this.group();
    return !!g && (g.grace_period_soft_days != null || g.grace_period_hard_days != null);
  });

  money(value: string | null | undefined): string {
    return this.currencyService.format(Number(value) || 0);
  }

  cycleLabel(cycle: string | null | undefined): string {
    return planCycleLabel(cycle);
  }

  graceText(days: number | null | undefined): string {
    return days == null ? '—' : `${days} d`;
  }
}
