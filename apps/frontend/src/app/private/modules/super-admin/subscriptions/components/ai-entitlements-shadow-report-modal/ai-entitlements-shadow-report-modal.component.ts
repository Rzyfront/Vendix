import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  AI_AGENT_LABELS,
  findAICapability,
  isAIAgentKey,
} from '../../../../../../shared/constants/ai-capabilities';
import type { AIEntitlementsShadowReport } from '../../services/subscription-admin.service';

/** Read-only view of the shadow report: legacy AI flags vs the entitlements model. */
@Component({
  selector: 'app-ai-entitlements-shadow-report-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Modelo nuevo vs actual"
      subtitle="Compara la configuración de IA guardada hoy con el modelo de capacidades"
      size="lg"
    >
      <div class="space-y-4" data-testid="ai-shadow-report">
        @if (loading()) {
          <p class="text-sm text-text-secondary">Cargando comparación...</p>
        } @else if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        } @else if (report(); as data) {
          <p class="text-base font-semibold text-text-primary" data-testid="ai-shadow-headline">
            {{ headline() }}
          </p>

          @for (plan of plansWithDifferences(); track plan.plan_id) {
            <section class="rounded-lg border border-border bg-background p-3 space-y-2">
              <h3 class="text-sm font-semibold text-text-primary">
                {{ plan.name }}
                <span class="font-normal text-text-secondary">({{ plan.code }})</span>
              </h3>
              <ul class="space-y-1 text-sm text-text-secondary">
                @for (diff of plan.differences; track diff.capability + diff.kind) {
                  <li>
                    <span class="font-medium text-text-primary">{{ capabilityLabel(diff.capability) }}</span>:
                    {{ diff.legacy }} → {{ diff.current }}
                    <span class="text-xs">
                      ({{ diff.kind === 'divergence' ? 'diferencia' : 'solo en el modelo nuevo' }})
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          <p class="text-sm text-text-secondary" data-testid="ai-shadow-runtime">
            Decisiones del modelo nuevo registradas en el servidor: {{ data.runtime.total }}
          </p>
        }
      </div>
      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
      </div>
    </app-modal>
  `,
})
export class AIEntitlementsShadowReportModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly report = input<AIEntitlementsShadowReport | null>(null);
  readonly loading = input<boolean>(false);
  readonly errorMessage = input<string>('');

  readonly plansWithDifferences = computed(() =>
    (this.report()?.plans ?? []).filter((plan) => plan.differences.length > 0),
  );

  readonly headline = computed(() => {
    const total = (this.report()?.total_divergences ?? 0) + (this.report()?.total_new_model_only ?? 0);
    if (total === 0) return 'Sin diferencias';
    return total === 1 ? '1 diferencia' : `${total} diferencias`;
  });

  /** `vex.agent` becomes «Vex · Agente Vex»; unknown ids are shown as received. */
  capabilityLabel(capability: string): string {
    const [agent, key] = capability.split('.');
    const def = agent && key ? findAICapability(agent, key) : undefined;
    if (!def || !isAIAgentKey(agent)) return capability;
    return `${AI_AGENT_LABELS[agent]} · ${def.label}`;
  }
}
