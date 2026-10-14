import { Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  ActivatePlanPreview,
  ActivateStorePlanResult,
} from '../../interfaces/subscription-admin.interface';
import {
  ACTIVATION_PAYMENT_METHOD_OPTIONS,
  ActivationFormValues,
  toCents,
} from './activation-payment-step.component';

const STATE_LABELS: Record<string, string> = {
  active: 'Activa',
  trial: 'Prueba',
  grace_soft: 'Gracia',
  grace_hard: 'Gracia',
  past_due: 'Vencida',
  suspended: 'Suspendida',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending_payment: 'Pendiente de pago',
  draft: 'Borrador',
};

@Component({
  selector: 'app-activation-summary',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (result(); as r) {
      <div class="space-y-4">
        <div
          class="flex items-start gap-3 rounded-lg border border-border bg-background p-4"
        >
          <app-icon
            name="check-circle"
            [size]="22"
            class="text-primary mt-0.5"
          ></app-icon>
          <div>
            <h3 class="text-base font-semibold text-text-primary">
              Plan asignado
            </h3>
            <p class="text-sm text-text-secondary">
              {{ storeName() ? storeName() + ': ' : '' }}{{ r.plan_name }}
            </p>
          </div>
        </div>

        <dl class="rounded-lg border border-border divide-y divide-border">
          <div class="flex justify-between gap-4 p-3 text-sm">
            <dt class="text-text-secondary">Plan</dt>
            <dd class="text-text-primary font-medium text-right">
              {{ r.plan_name }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 p-3 text-sm">
            <dt class="text-text-secondary">Estado</dt>
            <dd class="text-text-primary font-medium text-right">
              {{ stateLabel(r.state) }}
            </dd>
          </div>
          @if (r.period_start && r.period_end) {
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Período</dt>
              <dd class="text-text-primary text-right">
                {{ formatDate(r.period_start) }} – {{ formatDate(r.period_end) }}
              </dd>
            </div>
          }
          @if (r.invoice_number) {
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">N° de factura</dt>
              <dd class="text-text-primary font-medium text-right">
                {{ r.invoice_number }}
              </dd>
            </div>
          }
          @if (r.payment_id !== null) {
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">ID de pago</dt>
              <dd class="text-text-primary text-right">#{{ r.payment_id }}</dd>
            </div>
          }
          @if (r.amount_paid !== null) {
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Monto pagado</dt>
              <dd class="text-text-primary font-medium text-right">
                {{ money(r.amount_paid) }}
              </dd>
            </div>
          }
        </dl>

        @if (r.invoice_id !== null) {
          <p class="flex items-start gap-2 text-xs text-text-secondary">
            <app-icon
              name="info"
              [size]="14"
              class="mt-0.5 shrink-0"
            ></app-icon>
            La factura electrónica se emite en segundo plano.
          </p>
        }
      </div>
    } @else {
      @if (preview(); as p) {
        <div class="space-y-4">
          <dl class="rounded-lg border border-border divide-y divide-border">
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Tienda</dt>
              <dd class="text-text-primary font-medium text-right">
                {{ storeName() }}
              </dd>
            </div>
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Plan</dt>
              <dd class="text-text-primary font-medium text-right">
                {{ planName() }}{{ cycleLabel() ? ' · ' + cycleLabel() : '' }}
              </dd>
            </div>
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Período</dt>
              <dd class="text-text-primary text-right">
                {{ formatDate(p.period_start) }} – {{ formatDate(p.period_end) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4 p-3 text-sm">
              <dt class="text-text-secondary">Estado resultante</dt>
              <dd class="text-text-primary font-medium text-right">Activa</dd>
            </div>
          </dl>

          @if (p.is_free) {
            <div
              class="flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm"
            >
              <app-icon
                name="info"
                [size]="18"
                class="text-primary mt-0.5"
              ></app-icon>
              <p class="text-text-primary">Se activa sin factura ni pago.</p>
            </div>
          } @else {
            <div>
              <h4 class="text-xs font-semibold uppercase text-text-secondary mb-2">
                Factura
              </h4>
              <dl class="rounded-lg border border-border divide-y divide-border">
                <div class="flex justify-between gap-4 p-3 text-sm">
                  <dt class="text-text-secondary">Total</dt>
                  <dd class="text-text-primary font-medium text-right">
                    {{ money(p.invoice_total) }}
                  </dd>
                </div>
                @if (creditApplied() > 0) {
                  <div class="flex justify-between gap-4 p-3 text-sm">
                    <dt class="text-text-secondary">Crédito aplicado</dt>
                    <dd class="text-text-primary text-right">
                      {{ money(p.pending_credit_applied) }}
                    </dd>
                  </div>
                }
              </dl>
            </div>

            @if (values(); as v) {
              <div>
                <h4
                  class="text-xs font-semibold uppercase text-text-secondary mb-2"
                >
                  Pago
                </h4>
                <dl class="rounded-lg border border-border divide-y divide-border">
                  <div class="flex justify-between gap-4 p-3 text-sm">
                    <dt class="text-text-secondary">Monto recibido</dt>
                    <dd class="text-text-primary font-medium text-right">
                      {{ money(v.amount) }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4 p-3 text-sm">
                    <dt class="text-text-secondary">Medio de pago</dt>
                    <dd class="text-text-primary text-right">
                      {{ methodLabel() }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4 p-3 text-sm">
                    <dt class="text-text-secondary">Fecha de pago</dt>
                    <dd class="text-text-primary text-right">
                      {{ formatDate(v.paid_at) }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4 p-3 text-sm">
                    <dt class="text-text-secondary">Referencia</dt>
                    <dd class="text-text-primary text-right">
                      {{ referenceLabel() }}
                    </dd>
                  </div>
                </dl>
              </div>
            }
          }

          @if (p.warnings.length > 0) {
            <section
              class="rounded-lg border border-border bg-surface p-3 space-y-2"
              aria-label="Avisos"
            >
              <h4 class="text-sm font-semibold text-text-primary">Avisos</h4>
              <ul class="space-y-2">
                @for (w of p.warnings; track w.code) {
                  <li class="flex items-start gap-2 text-sm text-text-primary">
                    <app-icon
                      name="info"
                      [size]="16"
                      class="text-text-secondary mt-0.5 shrink-0"
                    ></app-icon>
                    <span>{{ w.message }}</span>
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      }
    }
  `,
})
export class ActivationSummaryComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);

  // Modo confirmacion
  readonly storeName = input<string>('');
  readonly planName = input<string>('');
  readonly cycleLabel = input<string>('');
  readonly preview = input<ActivatePlanPreview | null>(null);
  readonly values = input<ActivationFormValues | null>(null);

  // Modo exito
  readonly result = input<ActivateStorePlanResult | null>(null);

  readonly creditApplied = computed(() =>
    toCents(this.preview()?.pending_credit_applied),
  );

  readonly methodLabel = computed(() => {
    const method = this.values()?.payment_method;
    return (
      ACTIVATION_PAYMENT_METHOD_OPTIONS.find((o) => o.value === method)
        ?.label ?? String(method ?? '')
    );
  });

  readonly referenceLabel = computed(() => {
    const ref = this.values()?.reference?.trim();
    return ref ? ref : 'Se genera automáticamente';
  });

  money(value: string | number | null | undefined): string {
    return this.currencyFormat.format(value);
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }

  stateLabel(state: string): string {
    return STATE_LABELS[state] ?? state;
  }
}
