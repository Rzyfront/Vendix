import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';

/** Datos de la atención en estación que ve el cliente (seguimiento y Mis pedidos). */
export interface ServiceSessionDetailsData {
  status?: string | null;
  station_name?: string | null;
  service_name?: string | null;
  subject_label?: string | null;
  provider_name?: string | null;
  /** Quién dejó el vehículo/equipo o recibe el servicio. */
  customer_name?: string | null;
  opened_at?: string | Date | null;
  closed_at?: string | Date | null;
  intake?: Array<{ label: string; value: string }> | null;
}

/**
 * Bloque "Servicio en estación" para proyectar en el slot `after-products` del
 * resumen de orden de la tienda (`app-guest-order-summary`): mismo lenguaje
 * visual que la tarjeta de envío, sin parecer otra página.
 */
@Component({
  selector: 'app-service-session-details',
  standalone: true,
  imports: [DatePipe, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      <section class="order-section" aria-label="Servicio en estación">
        <div class="section-header">
          <app-icon name="warehouse" [size]="18" />
          <h2>Servicio en estación</h2>
          <span class="status-pill" [class.is-done]="!inProgress()">{{ statusLabel() }}</span>
        </div>
        <div class="extras-list">
          <div class="extra-row">
            <div class="extra-row-main">
              <span class="extra-row-title">{{ d.subject_label || d.service_name || 'Servicio' }}</span>
              <span class="extra-row-sub">
                {{ d.service_name || 'Servicio' }} · {{ d.station_name || 'Estación' }}
              </span>
            </div>
          </div>
          <dl class="facts">
            @if (d.provider_name) {
              <div><dt>Te atiende</dt><dd>{{ d.provider_name }}</dd></div>
            }
            @if (d.customer_name) {
              <div><dt>Recibido de</dt><dd>{{ d.customer_name }}</dd></div>
            }
            @if (d.opened_at) {
              <div><dt>Ingreso</dt><dd>{{ d.opened_at | date: 'short' }}</dd></div>
            }
            @if (d.closed_at) {
              <div><dt>Finalizado</dt><dd>{{ d.closed_at | date: 'short' }}</dd></div>
            }
            @if (pendingBalance() !== null) {
              <div>
                <dt>Pago</dt>
                <dd [class.pending]="pendingBalance()! > 0">
                  {{ pendingBalance()! > 0 ? 'Pendiente: ' + (pendingBalance()! | currency) : 'Pagado' }}
                </dd>
              </div>
            }
          </dl>
          @if (d.intake?.length) {
            <div class="intake">
              <span class="intake-title">Datos de la recepción</span>
              <dl class="facts">
                @for (answer of d.intake; track answer.label) {
                  <div><dt>{{ answer.label }}</dt><dd>{{ answer.value }}</dd></div>
                }
              </dl>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .order-section { padding: 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-lg, 0.75rem); background: var(--color-surface); }
    .section-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; color: var(--color-primary); }
    .section-header h2 { margin: 0; font-size: var(--fs-lg, 1.125rem); font-weight: var(--fw-semibold, 600); color: var(--color-text-primary); }
    .status-pill { margin-left: auto; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent); color: var(--color-warning, #b45309); }
    .status-pill.is-done { background: color-mix(in srgb, var(--color-success, #16a34a) 15%, transparent); color: var(--color-success, #15803d); }
    .extras-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .extra-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.5rem); background: var(--color-background); }
    .extra-row-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
    .extra-row-title { font-weight: var(--fw-semibold, 600); color: var(--color-text-primary); }
    .extra-row-sub { font-size: var(--fs-sm, 0.875rem); color: var(--color-text-secondary); }
    .facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem 1rem; }
    .facts div { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .facts dt { font-size: 0.75rem; color: var(--color-text-secondary); }
    .facts dd { margin: 0; font-weight: 600; color: var(--color-text-primary); overflow-wrap: anywhere; }
    .facts dd.pending { color: var(--color-error, #dc2626); }
    .intake { padding-top: 0.75rem; border-top: 1px solid var(--color-border); }
    .intake-title { display: block; margin-bottom: 0.5rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
  `],
})
export class ServiceSessionDetailsComponent {
  readonly data = input<ServiceSessionDetailsData | null>(null);
  /** Saldo por pagar; null oculta la fila de pago. */
  readonly pendingBalance = input<number | null>(null);
  /** El seguimiento público marca "finalizado" cuando el enlace se cierra. */
  readonly finished = input(false);

  readonly inProgress = computed(() => {
    const status = this.data()?.status;
    return !this.finished() && (!status || status === 'open' || status === 'paused');
  });

  readonly statusLabel = computed(() => {
    if (this.finished()) return 'Finalizado';
    switch (this.data()?.status) {
      case 'paused': return 'En pausa';
      case 'closed': return 'Finalizado';
      case 'cancelled': return 'Cancelado';
      default: return 'En proceso';
    }
  });
}
