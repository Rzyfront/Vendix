import { Component, computed, inject, input, signal } from '@angular/core';

import {
  AgentUsageMeter,
  SubscriptionAccessService,
} from '../../../../../core/services/subscription-access.service';

/**
 * Read-only consumption bars of ONE agent (N7): messages, model tokens and
 * voice readout, from `agent_usage` of `GET /store/subscriptions/usage`.
 * Hidden when the backend does not send the block.
 */
@Component({
  selector: 'app-agent-usage-meters',
  standalone: true,
  imports: [],
  template: `
    @if (loaded() && meters().length > 0) {
      <section
        class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-4 sm:p-6 mt-6"
        [attr.aria-labelledby]="'usage-title-' + agent()"
      >
        <h2
          class="text-lg font-semibold text-[var(--color-text-primary)]"
          [id]="'usage-title-' + agent()"
        >
          Consumo
        </h2>
        <p class="text-sm text-[var(--color-text-secondary)] mb-4">
          Lo que {{ agent() === 'vex' ? 'Vex' : 'Vexi' }} ha usado frente al
          cupo de tu plan.
        </p>
        <ul class="space-y-4">
          @for (meter of meters(); track meter.capability_key) {
            <li>
              <div
                class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
              >
                <span class="font-semibold text-[var(--color-text-primary)]">{{
                  meter.label
                }}</span>
                <span class="text-[var(--color-text-secondary)]">
                  @if (!meter.enabled) {
                    No incluido en tu plan
                  } @else if (meter.cap === null) {
                    {{ format(meter, meter.used) }} · Sin límite ·
                    {{ periodLabel(meter) }}
                  } @else {
                    {{ format(meter, meter.used) }} /
                    {{ format(meter, meter.cap) }} · {{ periodLabel(meter) }}
                  }
                </span>
              </div>
              @if (meter.enabled && meter.cap !== null) {
                <div
                  class="mt-2 h-2 rounded-full bg-[var(--color-border)] overflow-hidden"
                  role="progressbar"
                  [attr.aria-label]="meter.label"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  [attr.aria-valuenow]="percent(meter)"
                >
                  <div
                    class="h-full rounded-full transition-all"
                    [class.bg-primary-600]="percent(meter) < 90"
                    [class.bg-[var(--color-warning)]]="percent(meter) >= 90"
                    [style.width.%]="percent(meter)"
                  ></div>
                </div>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class AgentUsageMetersComponent {
  private readonly access = inject(SubscriptionAccessService);

  readonly agent = input.required<'vex' | 'vexi'>();

  private readonly all = signal<
    Record<'vex' | 'vexi', { meters: AgentUsageMeter[] }> | null
  >(null);
  readonly loaded = signal(false);

  readonly meters = computed(() => this.all()?.[this.agent()]?.meters ?? []);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const report = await this.access.getAiUsageReport();
      this.all.set(report.agent_usage ?? null);
    } finally {
      this.loaded.set(true);
    }
  }

  percent(meter: AgentUsageMeter): number {
    if (meter.cap === null || meter.cap <= 0) return meter.used > 0 ? 100 : 0;
    return Math.min(100, Math.round((meter.used / meter.cap) * 100));
  }

  periodLabel(meter: AgentUsageMeter): string {
    return meter.period === 'daily' ? 'hoy' : 'este mes';
  }

  /** Seconds read as minutes; messages and tokens as plain thousands. */
  format(meter: AgentUsageMeter, value: number): string {
    if (meter.unit === 'seconds') {
      const minutes = value / 60;
      if (value > 0 && minutes < 1) return 'menos de 1 min';
      const shown = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes);
      return `${shown.toLocaleString('es-CO', { maximumFractionDigits: 1 })} min`;
    }
    return Math.round(value).toLocaleString('es-CO');
  }
}
