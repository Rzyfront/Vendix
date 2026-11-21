import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  BadgeComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';
import { SuperadminTenantApiService } from '../../services/superadmin-tenant-api.service';
import { TenantContextStore } from '../../state/tenant-context.store';
import type { TenantAgentStatus } from './tenant-agent-status.interface';

/**
 * Tarjeta «Agentes IA» de la ficha de tienda: encendido o apagado de Vex y
 * Vexi con el motivo. El texto lo calcula el servidor, el mismo que ve el
 * dueño de la tienda, así que aquí no se reinterpreta nada.
 */
@Component({
  selector: 'app-tenant-ai-agents-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BadgeComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    SpinnerComponent,
  ],
  template: `
    <app-card [responsive]="true">
      <div class="space-y-4">
        <header class="min-w-0">
          <h2 class="text-base font-semibold text-text-primary">Agentes IA</h2>
          <p class="mt-0.5 text-xs text-text-secondary">
            Por qué Vex y Vexi están encendidos o apagados en esta tienda.
          </p>
        </header>

        @if (loading()) {
          <div
            class="flex items-center gap-2 py-4 text-sm text-text-secondary"
            role="status"
            aria-live="polite"
          >
            <app-spinner size="sm"></app-spinner>
            Consultando estado de los agentes…
          </div>
        } @else if (failed()) {
          <app-empty-state
            icon="alert-triangle"
            title="No se pudo cargar el estado"
            description="Intenta recargar la ficha de la tienda."
            [showActionButton]="false"
          ></app-empty-state>
        } @else {
          <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list">
            @for (agent of agents(); track agent.agent_key) {
              <li class="rounded-lg border border-border bg-background p-3">
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="flex items-center gap-2 text-sm font-semibold text-text-primary"
                  >
                    <app-icon name="bot" [size]="16" aria-hidden="true"></app-icon>
                    {{ agent.label }}
                  </span>
                  <app-badge
                    [variant]="agent.state === 'on' ? 'success' : 'warning'"
                    size="sm"
                  >
                    {{ agent.state === 'on' ? 'Encendido' : 'Apagado' }}
                  </app-badge>
                </div>
                @if (agent.reason) {
                  <p class="mt-2 text-xs text-text-secondary">
                    {{ agent.reason }}
                  </p>
                }
              </li>
            }
          </ul>
        }
      </div>
    </app-card>
  `,
})
export class TenantAiAgentsCardComponent {
  private readonly api = inject(SuperadminTenantApiService);
  private readonly context = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly agents = signal<readonly TenantAgentStatus[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const storeId = this.context.tenantId();
      if (storeId === null) return;
      this.load(storeId);
    });
  }

  private load(storeId: number): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .getAiAgentStatus(storeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.agents.set(res.data.agents);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }
}
