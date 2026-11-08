import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  CardComponent,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import {
  WorkflowLimitsApiService,
  WorkflowUsageMetric,
  WorkflowUsageMetricKey,
  WorkflowUsageSnapshot,
} from '../../services/workflow-limits-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';

const UPGRADE_ROUTE = '/admin/subscription/plans';
const MB = 1024 * 1024;
const GB = 1024 * MB;

const TITLES: Record<WorkflowUsageMetricKey, string> = {
  monthly_instances: 'Solicitudes este mes',
  monthly_http_calls: 'Llamadas HTTP este mes',
  storage_bytes: 'Almacenamiento',
  monthly_ai_tokens: 'Tokens de IA',
};

const number = (value: number, digits = 0): string =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(value);

/** Storage in MB under 1 GB of cap, GB above; never rounds a used byte count down to 0 of a non-empty store. */
function bytes(value: number, unit: 'MB' | 'GB'): string {
  return `${number(value / (unit === 'GB' ? GB : MB), unit === 'GB' ? 1 : 0)} ${unit}`;
}

/**
 * "Uso del plan" (Flujos P7.1): the four meters of the month against the plan
 * limits. Yellow from 80 %, red at 100 %. A plan without a cap reads "Sin
 * límite"; a feature the plan does not include reads "No incluido en tu plan".
 */
@Component({
  selector: 'app-workflow-plan-usage-page',
  standalone: true,
  imports: [StickyHeaderComponent, CardComponent, AlertBannerComponent, RouterLink],
  template: `
    <div class="w-full overflow-x-hidden" data-testid="plan-usage-page">
      <app-sticky-header
        title="Uso del plan"
        subtitle="Lo que llevan tus flujos este mes frente a los límites de tu plan"
        icon="gauge"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      @if (error()) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{ error() }}</app-alert-banner>
      }

      @if (blockedCount() > 0) {
        <app-alert-banner variant="danger" icon="alert-circle" data-testid="blocked-banner">
          Llegaste al límite de tu plan en algo de Flujos. Mejora tu plan para seguir.
        </app-alert-banner>
      }

      @if (loading()) {
        <div class="p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando uso del plan...</p>
        </div>
      } @else if (snapshot(); as snap) {
        <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          @for (m of snap.metrics; track m.key) {
            <app-card [responsive]="true" [title]="title(m)">
              <div [attr.data-testid]="'meter-' + m.key" [attr.data-state]="m.state">
                <p class="text-sm text-text-primary" data-testid="meter-text">{{ text(m) }}</p>
                @if (m.state === 'unlimited') {
                  <p class="mt-1 text-xs text-text-secondary">Tu plan no tiene tope para esto</p>
                } @else if (m.state === 'unavailable') {
                  <p class="mt-1 text-xs text-text-secondary">Mejora tu plan para activarlo</p>
                } @else {
                  <div
                    class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    [attr.aria-label]="'Uso: ' + title(m)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-valuenow]="width(m)"
                  >
                    <div
                      class="h-full rounded-full"
                      data-testid="meter-bar"
                      [class.bg-primary]="m.state === 'ok'"
                      [class.bg-warning]="m.state === 'warning'"
                      [class.bg-error]="m.state === 'blocked'"
                      [style.width.%]="width(m)"
                    ></div>
                  </div>
                  @if (m.state === 'warning') {
                    <p class="mt-1 text-xs text-warning">Estás cerca del límite</p>
                  } @else if (m.state === 'blocked') {
                    <p class="mt-1 text-xs text-error">Límite alcanzado</p>
                  }
                }
              </div>
            </app-card>
          }
        </div>

        <div class="mt-4 text-center">
          <a
            class="text-sm font-semibold text-primary underline"
            data-testid="upgrade-link"
            [routerLink]="upgradeRoute"
            >Mejorar plan</a
          >
        </div>
      }
    </div>
  `,
})
export class PlanUsagePageComponent implements OnInit {
  private readonly api = inject(WorkflowLimitsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly upgradeRoute = UPGRADE_ROUTE;
  readonly snapshot = signal<WorkflowUsageSnapshot | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly blockedCount = computed(
    () => this.snapshot()?.metrics.filter((m) => m.state === 'blocked').length ?? 0,
  );

  ngOnInit(): void {
    this.api
      .usage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snap) => {
          this.snapshot.set(snap);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(toWorkflowError(e).message);
          this.loading.set(false);
        },
      });
  }

  title(m: WorkflowUsageMetric): string {
    return TITLES[m.key];
  }

  width(m: WorkflowUsageMetric): number {
    return Math.max(0, Math.min(100, m.percent ?? 0));
  }

  text(m: WorkflowUsageMetric): string {
    if (m.state === 'unavailable') return 'No incluido en tu plan';
    switch (m.key) {
      case 'storage_bytes': {
        const unit = m.cap !== null && m.cap < GB ? 'MB' : 'GB';
        const used = `${number(m.used / (unit === 'GB' ? GB : MB), unit === 'GB' ? 1 : 0)}`;
        const usedText = unit === 'GB' && m.used < GB ? bytes(m.used, 'MB') : `${used} ${unit}`;
        return m.cap === null
          ? `Almacenamiento: ${usedText} · Sin límite`
          : `Almacenamiento: ${usedText} de ${bytes(m.cap, unit)}`;
      }
      case 'monthly_instances':
        return m.cap === null
          ? `Solicitudes este mes: ${number(m.used)} · Sin límite`
          : `Solicitudes este mes: ${number(m.used)} de ${number(m.cap)}`;
      case 'monthly_http_calls':
        return m.cap === null
          ? `Llamadas HTTP este mes: ${number(m.used)} · Sin límite`
          : `Llamadas HTTP este mes: ${number(m.used)} de ${number(m.cap)}`;
      default:
        return m.cap === null
          ? `Tokens de IA: ${number(m.used)} · Sin límite`
          : `Tokens de IA: ${number(m.used)} de ${number(m.cap)}`;
    }
  }
}
