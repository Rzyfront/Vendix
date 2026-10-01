import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import {
  SaveRequirement,
  SaveRequirementAction,
} from '../../../../../../shared/components/save-requirements-modal/save-requirements.interface';

export interface InvoiceSummaryTotals {
  subtotal: number;
  discount: number;
  taxable_base: number;
  taxable_base_label?: string;
  taxes: { label: string; amount: number }[];
  included_tax?: number;
  additional_tax?: number;
  withholdings: { label: string; amount: number }[];
  total: number;
  net_receivable: number;
  amount_in_words?: string;
  currency?: string;
}

/**
 * Resumen lateral de la factura: cifras, lista "Para emitir falta" y acciones.
 * Sólo pinta; el sticky lo pone el padre y ocupa el 100 % de su contenedor.
 */
@Component({
  selector: 'vendix-invoice-summary-aside',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full space-y-4">
      <section
        class="rounded-2xl border border-border bg-surface p-5 shadow-sm space-y-4"
        aria-label="Resumen de la factura"
      >
        <h3 class="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-text-primary">
          <app-icon name="calculator" [size]="16" class="text-primary" />
          Resumen de la factura
        </h3>

        <dl class="space-y-2.5 text-xs">
          <div class="flex items-center justify-between text-text-secondary">
            <dt>Subtotal</dt>
            <dd class="font-medium text-text-primary">{{ totals().subtotal | currency }}</dd>
          </div>
          @if (totals().discount > 0) {
            <div class="flex items-center justify-between text-text-secondary">
              <dt>Descuento</dt>
              <dd class="font-medium text-text-primary">- {{ totals().discount | currency }}</dd>
            </div>
          }
          <div class="flex items-center justify-between border-t border-border/50 pt-2 text-text-secondary">
            <dt>{{ totals().taxable_base_label || 'Base gravable' }}</dt>
            <dd class="font-medium text-text-primary">{{ totals().taxable_base | currency }}</dd>
          </div>
          @for (tax of totals().taxes; track $index) {
            <div class="flex items-center justify-between text-text-secondary">
              <dt>{{ tax.label }}</dt>
              <dd class="font-medium text-text-primary">{{ tax.amount | currency }}</dd>
            </div>
          }
          @for (w of totals().withholdings; track $index) {
            <div class="flex items-center justify-between text-text-secondary">
              <dt>{{ w.label }}</dt>
              <dd class="font-medium" style="color: var(--color-warning)">- {{ w.amount | currency }}</dd>
            </div>
          }
          <div class="flex items-center justify-between border-t border-border pt-3 text-sm font-bold text-text-primary">
            <dt>Total</dt>
            <dd class="text-base font-extrabold text-primary">{{ totals().total | currency }}</dd>
          </div>
          <div class="flex items-center justify-between text-text-secondary">
            <dt>Neto a recibir</dt>
            <dd class="font-semibold text-text-primary">{{ totals().net_receivable | currency }}</dd>
          </div>
        </dl>

        @if (totals().amount_in_words) {
          <p class="text-[11px] leading-relaxed text-text-secondary">
            Son: {{ totals().amount_in_words }}
          </p>
        }
      </section>

      <section
        class="rounded-xl border border-border/80 bg-surface-secondary/40 p-4 space-y-2"
        aria-live="polite"
      >
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-xs font-semibold text-text-primary">
            @if (hasRequirements()) { Para emitir falta } @else { Estado }
          </h4>
          @if (checking()) {
            <span class="flex items-center gap-1 text-[11px] text-text-secondary">
              <app-icon name="loader-2" [size]="12" [spin]="true" />
              Revisando…
            </span>
          }
        </div>

        @if (hasRequirements()) {
          <ul class="space-y-2">
            @for (req of requirements(); track req.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-start gap-2 rounded-lg border border-border bg-surface p-2.5 text-left text-xs transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2"
                  (click)="onRequirement(req)"
                >
                  <app-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0 text-warning" />
                  <span class="min-w-0 flex-1">
                    <span class="block font-semibold text-text-primary">{{ req.label }}</span>
                    @if (req.reason) {
                      <span class="block text-text-secondary">{{ req.reason }}</span>
                    }
                    @if (req.action) {
                      <span class="mt-1 inline-flex items-center gap-1 font-medium text-primary">
                        {{ req.action.label }}
                        <app-icon name="chevron-right" [size]="12" />
                      </span>
                    }
                  </span>
                </button>
              </li>
            }
          </ul>
        } @else if (!checking()) {
          <p class="flex items-center gap-1.5 text-xs font-medium text-success">
            <app-icon name="check-circle" [size]="14" />
            Lista para emitir
          </p>
        }

        @if (warnings().length > 0) {
          <details class="text-xs">
            <summary class="cursor-pointer font-medium text-text-secondary">
              Avisos ({{ warnings().length }})
            </summary>
            <ul class="mt-2 space-y-1.5">
              @for (w of warnings(); track w.id) {
                <li class="text-text-secondary">
                  <span class="font-semibold text-text-primary">{{ w.label }}</span>
                  @if (w.reason) { — {{ w.reason }} }
                </li>
              }
            </ul>
          </details>
        }
      </section>

      <div class="space-y-2">
        <app-button
          type="button"
          variant="primary"
          size="md"
          [fullWidth]="true"
          class="w-full justify-center"
          [loading]="busy()"
          [disabled]="busy() || !canSubmit()"
          (clicked)="submit.emit()"
        >
          {{ submitLabel() }}
        </app-button>
        <app-button
          type="button"
          variant="outline"
          size="sm"
          [fullWidth]="true"
          class="w-full justify-center"
          [disabled]="busy()"
          (clicked)="validate.emit()"
        >
          <app-icon slot="icon" name="shield-check" [size]="14" />
          Validar
        </app-button>
        <app-button
          type="button"
          variant="outline"
          size="sm"
          [fullWidth]="true"
          class="w-full justify-center"
          (clicked)="preview.emit()"
        >
          <app-icon slot="icon" name="eye" [size]="14" />
          Vista previa
        </app-button>
        <app-button
          type="button"
          variant="ghost"
          size="sm"
          [fullWidth]="true"
          class="w-full justify-center"
          [disabled]="busy()"
          (clicked)="cancel.emit()"
        >
          Cancelar
        </app-button>
      </div>
    </div>
  `,
})
export class InvoiceSummaryAsideComponent {
  readonly totals = input.required<InvoiceSummaryTotals>();
  readonly requirements = input<SaveRequirement[]>([]);
  readonly warnings = input<SaveRequirement[]>([]);
  readonly checking = input(false);
  readonly busy = input(false);
  readonly submitLabel = input('Crear factura');
  readonly canSubmit = input(true);

  readonly submit = output<void>();
  readonly validate = output<void>();
  readonly preview = output<void>();
  readonly cancel = output<void>();
  readonly requirementAction = output<SaveRequirementAction>();

  readonly hasRequirements = computed(() => this.requirements().length > 0);

  protected onRequirement(req: SaveRequirement): void {
    if (req.action) {
      this.requirementAction.emit(req.action);
    }
  }
}
