import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { environment } from '../../../../../environments/environment';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { FiscalWizardStepId } from '../../../../core/models/fiscal-status.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import {
  DIAN_ENABLEMENT_STATUS_LABELS,
  DIAN_ENVIRONMENT_LABELS,
  FiscalReadinessAxis,
  FiscalReadinessResponse,
} from '../../dian/fiscal-readiness.interface';

/** Ruta del asistente lineal "Activar facturación electrónica". */
const ACTIVATION_ROUTE = '/admin/invoicing/activation';

/** Vista por tienda de la config DIAN en el panel de organización (fiscal_scope=STORE). */
const ORG_DIAN_CONFIG_ROUTE = '/admin/invoicing/dian-config';

/**
 * Paso `dian_config` del asistente fiscal: REDIRIGE al asistente de activación.
 *
 * La habilitación DIAN de la factura de venta (formulario, certificado,
 * identidad del emisor, resolución, escáner) vive ahora en un único flujo, el
 * asistente "Activar facturación electrónica" (`/admin/invoicing/activation`,
 * D8/C3). Este paso es sólo un cursor del asistente fiscal: muestra el estado
 * real derivado de `GET <scope>/invoicing/dian-config/fiscal-readiness` y lleva
 * al usuario allá. La verdad la impone `finalize` en el backend, por eso
 * `valid` es siempre `true`.
 *
 * El código anterior de persistencia (POST a `dian-config`, `upload-certificate`,
 * `resolutions`) fue retirado de este componente; queda en el historial de git.
 */
@Component({
  selector: 'app-fiscal-dian-config-step',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="rounded-xl border border-border bg-[var(--color-surface)] p-4 md:p-6 space-y-4">
        <div class="flex items-start gap-3">
          <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true">
            <app-icon name="shield-check" [size]="18" />
          </span>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-text-primary">
              Habilitación DIAN de la factura de venta
            </h3>
            <p class="mt-1 text-sm text-text-secondary">
              Se hace en el asistente «Activar facturación electrónica»: 6 pasos
              guiados y puedes retomarlo donde quedó.
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-2 text-sm" aria-live="polite">
          @if (organizationDefersToStores()) {
            <span class="text-text-secondary">
              Cada tienda habilita su propia facturación electrónica. Revisa y
              configura la DIAN de cada tienda desde la vista por tienda, o entra
              al panel de la tienda.
            </span>
          } @else if (loading()) {
            <span class="text-text-secondary">Leyendo el estado de la habilitación…</span>
          } @else if (loadError(); as message) {
            <span class="text-text-secondary">{{ message }}</span>
          } @else {
            <span class="text-text-secondary">Estado actual: </span>
            <strong class="text-text-primary">{{ statusLabel() }}</strong>
            @if (environmentLabel(); as env) {
              <span class="text-text-secondary"> · Ambiente: </span>
              <strong class="text-text-primary">{{ env }}</strong>
            }
          }
        </div>

        <div class="flex justify-end">
          <app-button
            variant="primary"
            customClasses="min-h-11"
            [disabled]="submitting()"
            (clicked)="openActivation()"
          >
            {{ organizationDefersToStores() ? 'Ver configuración DIAN por tienda' : 'Abrir asistente de activación' }}
            <app-icon slot="icon" name="arrow-right" [size]="14" />
          </app-button>
        </div>
      </div>
    </div>
  `,
})
export class FiscalDianConfigStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId: FiscalWizardStepId = 'dian_config';

  /** Cursor del asistente: la verdad la impone `finalize` en el backend. */
  readonly valid = signal(true);
  readonly submitting = signal(false);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly axis = signal<FiscalReadinessAxis | null>(null);

  /**
   * Organización cuya propiedad fiscal es la tienda: no hay un
   * `organization/.../fiscal-readiness` (responde 400) ni asistente único.
   */
  readonly organizationDefersToStores = computed(
    () =>
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store',
  );

  private readiness_requested = false;

  readonly statusLabel = computed(() => {
    const status = this.axis()?.enablement_status ?? 'not_started';
    return DIAN_ENABLEMENT_STATUS_LABELS[status] ?? status;
  });

  readonly environmentLabel = computed(() => {
    const env = this.axis()?.environment;
    return env ? (DIAN_ENVIRONMENT_LABELS[env] ?? env) : null;
  });

  constructor() {
    this.requestReadinessOnce();
    // Si el estado fiscal se hidrata después del montaje, reacciona al cambio.
    effect(() => {
      this.organizationDefersToStores();
      untracked(() => this.requestReadinessOnce());
    });
  }

  private requestReadinessOnce(): void {
    if (this.organizationDefersToStores()) {
      this.loading.set(false);
      return;
    }
    if (this.readiness_requested) return;
    this.readiness_requested = true;
    this.loading.set(true);
    this.loadReadiness();
  }

  private loadReadiness(): void {
    const url = `${environment.apiUrl}/${this.service.userScope()}/invoicing/dian-config/fiscal-readiness`;
    this.http
      .get<any>(url, { params: this.service.storeContext() as Record<string, number> })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const payload: FiscalReadinessResponse | null = res?.data ?? res ?? null;
          // El eje de la factura de venta se llama `invoicing` en este contrato.
          this.axis.set(
            payload?.axes?.find((a) => a.configuration_type === 'invoicing') ?? null,
          );
          this.loadError.set(null);
          this.loading.set(false);
        },
        error: () => {
          this.axis.set(null);
          this.loadError.set('No se pudo leer el estado de la habilitación DIAN.');
          this.loading.set(false);
        },
      });
  }

  openActivation(): void {
    if (this.organizationDefersToStores()) {
      void this.router.navigate([ORG_DIAN_CONFIG_ROUTE]);
      return;
    }
    const storeId = this.service.storeContext().store_id;
    void this.router.navigate([ACTIVATION_ROUTE], {
      queryParams: storeId !== undefined ? { store_id: storeId } : undefined,
    });
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    this.submitting.set(true);
    try {
      const ref = { redirected_to: 'activation' };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    } finally {
      this.submitting.set(false);
    }
  }
}
