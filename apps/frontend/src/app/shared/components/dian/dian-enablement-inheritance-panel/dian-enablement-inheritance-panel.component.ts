import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';

import { parseApiError } from '../../../../core/utils/parse-api-error';
import {
  DIAN_API_CONTEXT,
  DianConfigApiService,
  type DianEnablementInheritance,
} from '../../../services/dian';
import { AlertBannerComponent } from '../../alert-banner/alert-banner.component';
import { ButtonComponent } from '../../button/button.component';
import { CardComponent } from '../../card/card.component';
import { IconComponent } from '../../icon/icon.component';
import { ToastService } from '../../toast/toast.service';

/**
 * Ofrece heredar la habilitación DIAN de un software que ya la tiene, sin
 * repetir el set de pruebas.
 *
 * Es legalmente delicado: los documentos que se emitan saldrán a nombre del NIT
 * dueño del software y serán válidos. Por eso la acción exige un checkbox de
 * entendimiento y el aviso legal del backend se muestra tal cual.
 *
 * Sólo aplica al carril de tienda (`capabilities().inheritEnablement`); en los
 * demás no consulta nada ni se muestra. Se oculta mientras `available` no sea
 * `true`, incluida la consulta en curso o fallida (no hay nada que ofrecer).
 */
@Component({
  selector: 'app-dian-enablement-inheritance-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBannerComponent, ButtonComponent, CardComponent, IconComponent],
  template: `
    @if (offer(); as info) {
      <app-card>
        <div class="flex flex-col gap-3">
          <div class="flex items-start gap-2">
            <app-icon name="shield-check" [size]="18" class="mt-0.5 text-[var(--color-primary)]"></app-icon>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
                Este software ya está habilitado ante la DIAN para el NIT {{ info.issuer_nit }}
              </h3>
              <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Puedes heredar esa habilitación sin repetir el set de pruebas. Esta configuración pasará
                directo a {{ targetLabel() }}.
              </p>
            </div>
          </div>

          <app-alert-banner variant="warning" icon="alert-triangle" heading="Aviso legal">
            <p>{{ info.legal_notice }}</p>
            <p class="mt-1 font-medium">
              Los documentos que emitas (facturas, notas crédito y débito y demás documentos
              electrónicos) saldrán a nombre del NIT {{ info.issuer_nit }}, dueño del software, y serán
              legalmente válidos.
            </p>
          </app-alert-banner>

          <label class="flex items-start gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              [checked]="acknowledged()"
              [disabled]="busy()"
              (change)="onAcknowledge($event)"
            />
            <span>Entiendo que los documentos se emitirán a nombre del NIT {{ info.issuer_nit }}</span>
          </label>

          @if (error(); as message) {
            <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
          }

          <div class="flex justify-end">
            <app-button
              variant="primary"
              [loading]="inheriting()"
              [disabled]="!canInherit()"
              (clicked)="inherit()"
            >
              Heredar habilitación
            </app-button>
          </div>
        </div>
      </app-card>
    }
  `,
})
export class DianEnablementInheritancePanelComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly dianContext = inject(DIAN_API_CONTEXT);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly configId = input.required<number>();
  readonly disabled = input(false);
  /** La habilitación se heredó: el host recarga su estado. */
  readonly inherited = output<void>();

  readonly info = signal<DianEnablementInheritance | null>(null);
  readonly acknowledged = signal(false);
  readonly inheriting = signal(false);
  readonly error = signal<string | null>(null);

  readonly supported = computed(() => this.dianContext.capabilities().inheritEnablement === true);
  /** Sólo hay panel cuando el backend dice que se puede heredar. */
  readonly offer = computed(() => {
    const info = this.info();
    return this.supported() && info?.available === true ? info : null;
  });
  readonly busy = computed(() => this.inheriting() || this.disabled());
  readonly canInherit = computed(() => this.offer() !== null && this.acknowledged() && !this.busy());
  readonly targetLabel = computed(() =>
    this.info()?.target_environment === 'production' ? 'producción' : 'pruebas aprobadas',
  );

  private lookup: Subscription | null = null;

  constructor() {
    effect(() => {
      const id = this.configId();
      const supported = this.supported();
      this.lookup?.unsubscribe();
      this.info.set(null);
      this.acknowledged.set(false);
      this.error.set(null);
      if (!supported) return;
      this.lookup = this.api
        .getEnablementInheritance(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => this.info.set(response?.data ?? null),
          // Best-effort: sin respuesta no hay nada que ofrecer.
          error: () => this.info.set(null),
        });
    });
  }

  onAcknowledge(event: Event): void {
    this.acknowledged.set((event.target as HTMLInputElement).checked);
  }

  inherit(): void {
    if (!this.canInherit()) return;
    this.inheriting.set(true);
    this.error.set(null);
    this.api
      .inheritEnablement(this.configId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.inheriting.set(false);
          this.toast.success('Habilitación heredada');
          this.inherited.emit();
        },
        error: (err) => {
          this.inheriting.set(false);
          this.error.set(parseApiError(err).userMessage);
        },
      });
  }
}
