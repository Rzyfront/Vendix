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
 * Sólo pinta; el sticky (y el desplazamiento interno) lo pone el padre, y
 * ocupa el 100 % de su contenedor.
 *
 * Jerarquía: desglose en texto secundario con cifras a la derecha y dígitos
 * tabulares; TOTAL en bloque tintado con el token primario (neto y «Son:»
 * subordinados); estado con ícono + texto; acciones en tres niveles.
 */
@Component({
  selector: 'vendix-invoice-summary-aside',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full space-y-4">
      @if (showTotals()) {
        <section
          class="rounded-2xl border border-border bg-surface p-4 shadow-sm"
          aria-label="Resumen de la factura"
        >
          <h3 class="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <span
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <app-icon name="calculator" [size]="15" />
            </span>
            Resumen de la factura
          </h3>

          <!-- Desglose: etiqueta secundaria a la izquierda, cifra alineada a la
               derecha con dígitos tabulares para que las columnas cuadren. -->
          <dl class="mt-4 space-y-2 text-xs">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-text-secondary">Subtotal</dt>
              <dd class="text-right font-medium tabular-nums text-text-primary">
                {{ totals().subtotal | currency }}
              </dd>
            </div>
            @if (totals().discount > 0) {
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-text-secondary">Descuento</dt>
                <dd class="text-right font-medium tabular-nums text-text-primary">
                  - {{ totals().discount | currency }}
                </dd>
              </div>
            }
            <div class="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt class="text-text-secondary">
                {{ totals().taxable_base_label || 'Base gravable' }}
              </dt>
              <dd class="text-right font-medium tabular-nums text-text-primary">
                {{ totals().taxable_base | currency }}
              </dd>
            </div>
            @for (tax of totals().taxes; track $index) {
              <div class="flex items-baseline justify-between gap-3">
                <dt class="min-w-0 truncate text-text-secondary" [title]="tax.label">
                  {{ tax.label }}
                </dt>
                <dd class="shrink-0 text-right font-medium tabular-nums text-text-primary">
                  {{ tax.amount | currency }}
                </dd>
              </div>
            }
            @if (totals().withholdings.length > 0) {
              <div class="space-y-2 border-t border-border pt-2">
                @for (w of totals().withholdings; track $index) {
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="min-w-0 truncate text-text-secondary" [title]="w.label">
                      {{ w.label }}
                    </dt>
                    <dd class="shrink-0 text-right font-medium tabular-nums text-warning">
                      - {{ w.amount | currency }}
                    </dd>
                  </div>
                }
              </div>
            }
          </dl>

          <!-- TOTAL: bloque tintado con el token primario. Neto y «Son:» van
               dentro, subordinados, porque se leen como derivados del total. -->
          <div class="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Total
              </span>
              <span class="text-right text-xl font-bold leading-tight tabular-nums text-primary">
                {{ totals().total | currency }}
              </span>
            </div>
            <div class="mt-2 flex items-baseline justify-between gap-3 border-t border-primary/15 pt-2 text-xs">
              <span class="text-text-secondary">Neto a recibir</span>
              <span class="text-right font-semibold tabular-nums text-text-primary">
                {{ totals().net_receivable | currency }}
              </span>
            </div>
            @if (totals().amount_in_words) {
              <p class="mt-1.5 text-[11px] leading-snug text-text-secondary">
                Son: {{ totals().amount_in_words }}
              </p>
            }
          </div>
        </section>
      }

      <!-- ESTADO: tres lecturas posibles, cada una con ícono y texto (nunca
           sólo color): revisando, lo que falta, o lista para emitir. -->
      <section
        class="rounded-2xl border bg-surface p-4"
        [class]="hasRequirements() ? 'border-warning/40' : 'border-border'"
        aria-live="polite"
      >
        <div class="flex items-center justify-between gap-2">
          <h4 class="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
            @if (hasRequirements()) {
              <app-icon name="alert-triangle" [size]="14" class="shrink-0 text-warning" />
              Para emitir falta
              <span
                class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold tabular-nums text-text-primary"
              >
                {{ requirements().length }}
              </span>
            } @else {
              <app-icon name="clipboard-check" [size]="14" class="shrink-0 text-text-secondary" />
              Estado
            }
          </h4>
          @if (checking()) {
            <span class="flex items-center gap-1 text-[11px] text-text-secondary">
              <app-icon name="loader-2" [size]="12" [spin]="true" />
              Revisando…
            </span>
          }
        </div>

        @if (hasRequirements()) {
          <ul class="mt-3 space-y-2">
            @for (req of requirements(); track req.id) {
              <li>
                <button
                  type="button"
                  class="group flex w-full items-start gap-2 rounded-lg border border-border bg-surface p-2.5 text-left text-xs transition-colors hover:border-warning hover:bg-[var(--color-surface-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                  (click)="onRequirement(req)"
                >
                  <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block font-semibold text-text-primary">{{ req.label }}</span>
                    @if (req.reason) {
                      <span class="mt-0.5 block leading-snug text-text-secondary">{{ req.reason }}</span>
                    }
                    @if (req.action) {
                      <span class="mt-1.5 inline-flex items-center gap-1 font-medium text-primary group-hover:underline">
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
          <p
            class="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-text-primary"
          >
            <app-icon name="check-circle" [size]="15" class="shrink-0 text-success" />
            Lista para emitir
          </p>
        }

        @if (warnings().length > 0) {
          <details class="group mt-3 border-t border-border pt-3 text-xs">
            <summary
              class="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden gap-1.5 rounded font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <app-icon name="info" [size]="13" class="shrink-0" />
              Avisos ({{ warnings().length }})
              <app-icon
                name="chevron-down"
                [size]="13"
                class="ml-auto shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <ul class="mt-2 space-y-1.5">
              @for (w of warnings(); track w.id) {
                <li class="leading-snug text-text-secondary">
                  <span class="font-semibold text-text-primary">{{ w.label }}</span>
                  @if (w.reason) { — {{ w.reason }} }
                </li>
              }
            </ul>
          </details>
        }
      </section>

      <!-- ACCIONES: primaria a todo el ancho; Validar y Vista previa en fila
           de dos; Cancelar como acción terciaria. -->
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
          <app-icon slot="icon" name="send" [size]="15" />
          {{ submitLabel() }}
        </app-button>
        <div class="grid grid-cols-2 gap-2">
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
        </div>
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
  /** `false` cuando la página aún no tiene cifras propias (p. ej. desde pedido). */
  readonly showTotals = input(true);

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
