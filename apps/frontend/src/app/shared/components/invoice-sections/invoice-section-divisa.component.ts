import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import type { ExchangeRateQuote } from '../../services/exchange-rate.service';
import { optionalControl, requireControl } from './invoice-section-controls';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

const SECTION = 'Divisa';

/**
 * Dónde vive cada campo. `exchange_rate`/`exchange_rate_date` son `null` en
 * contexto `profile`: la tasa es del día de cada factura y se consulta al
 * emitir, no algo que un perfil pueda congelar.
 */
export interface DivisaSectionPaths {
  declare_foreign: string;
  currency_code: string;
  exchange_rate: string | null;
  exchange_rate_date: string | null;
}

/**
 * Sección «Divisa»: B.6 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Por qué dos plantillas y no una con banderas de campo
 *
 * El perfil sólo declara SI se declara conversión y a QUÉ divisa —dos
 * controles—. La factura, además, consulta la TRM oficial del día, permite
 * corregirla a mano, la fecha de esa tasa y pinta el equivalente declarado:
 * cuatro piezas de estado (`exchangeRateQuote`, `loadingExchangeRate`,
 * `exchangeRateOverridden`, `foreignTotalLabel`) que no tienen dónde vivir
 * en un perfil, que no emite nada. Forzarlas a un perfil habría significado
 * simular una consulta de TRM que ese formulario nunca dispara.
 *
 * ## Lo que la página sigue decidiendo
 *
 * Todo el estado de la consulta a la TRM (`quote`, `loading`, `overridden`,
 * `unavailableReason`, `foreignTotalLabel`, `formatCurrency`) es sólo de
 * `invoice` y lo sigue calculando `ExchangeRateService` en la página. El
 * componente sólo lo pinta.
 */
@Component({
  selector: 'vendix-invoice-section-divisa',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, IconComponent, InputComponent, SelectorComponent, ToggleComponent],
  template: `
    @if (isProfile()) {
      <div class="space-y-3">
        <app-toggle
          label="Declarar conversión a divisa extranjera"
          [formControl]="declareForeignControl()"
          helpText="La factura se emite SIEMPRE en pesos. Esto sólo añade la conversión al XML (Res. DIAN 000042/2020, art. 73)."
        ></app-toggle>

        <app-selector
          label="Divisa"
          [formControl]="currencyCodeControl()"
          [options]="currencyOptions()"
          size="sm"
          placeholder="Sin divisa"
          helpText="Se guarda la divisa, no la tasa: la tasa es del día de cada factura."
          [errorText]="errors().currency_code ?? ''"
        ></app-selector>
      </div>
    } @else {
      <div
        class="rounded-lg border border-border bg-surface-secondary p-2 mb-3 flex items-start gap-2"
      >
        <app-icon name="info" [size]="14" class="text-primary shrink-0 mt-0.5"></app-icon>
        <p class="text-xs text-text-primary">
          <strong>La factura se emite siempre en pesos colombianos.</strong>
          La divisa extranjera sólo DECLARA la conversión
          (<code>cac:PaymentAlternativeExchangeRate</code>) y no cambia el
          importe legal: el valor exigible sigue siendo el total en COP. Res.
          DIAN 000042/2020, art. 73.
        </p>
      </div>

      <div class="mb-3">
        <app-toggle
          [formControl]="declareForeignControl()"
          label="Declarar la conversión a una divisa extranjera"
          ariaLabel="Declarar la conversión a una divisa extranjera"
        ></app-toggle>
      </div>

      @if (usesForeignCurrency()) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <app-selector
            label="Divisa"
            [formControl]="currencyCodeControl()"
            [options]="currencyOptions()"
            [errorText]="errors().currency_code ?? ''"
            [required]="true"
            size="sm"
            (valueChange)="exchangeRateInputsChanged.emit()"
          ></app-selector>
          <app-input
            label="Tasa del día (COP por unidad)"
            type="number"
            [formControl]="exchangeRateControl()!"
            [control]="exchangeRateControl()"
            [error]="errors().exchange_rate"
            [required]="true"
            min="0"
            step="any"
            size="sm"
          ></app-input>
          <app-input
            label="Fecha de la TRM"
            type="date"
            [formControl]="exchangeRateDateControl()!"
            [control]="exchangeRateDateControl()"
            [error]="errors().exchange_rate_date"
            size="sm"
            (inputChange)="exchangeRateInputsChanged.emit()"
          ></app-input>
        </div>

        <!--
          Estado de la consulta a la TRM oficial. Se pinta SIEMPRE que haya
          divisa: el silencio sobre de dónde salió la tasa es lo que hacía
          que un valor tecleado a ojo pareciera verificado.
        -->
        <div class="mt-2 min-h-[20px]">
          @if (exchangeRateLoading()) {
            <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <app-icon name="loader" [size]="12" class="animate-spin"></app-icon>
              Consultando la TRM oficial…
            </p>
          } @else if (exchangeRateQuote(); as quote) {
            @if (quote.rate) {
              <p class="flex flex-wrap items-center gap-1.5 text-[11px] text-success">
                <app-icon name="check-circle" [size]="12"></app-icon>
                TRM oficial del {{ quote.date }}:
                <span class="font-semibold">{{ formatCurrency()(+quote.rate) }}</span>
                @if (quote.trm) {
                  <span class="text-text-secondary">
                    (rige del {{ quote.trm.valid_from }} al {{ quote.trm.valid_to }})
                  </span>
                }
                @if (exchangeRateOverridden()) {
                  <button
                    type="button"
                    class="underline underline-offset-2 hover:no-underline"
                    (click)="applyOfficialExchangeRate.emit()"
                  >
                    Usar la oficial
                  </button>
                }
              </p>
            } @else {
              <p class="flex items-start gap-1.5 text-[11px] text-warning">
                <app-icon name="alert-circle" [size]="12" class="mt-0.5 shrink-0"></app-icon>
                {{ exchangeRateUnavailableReason() }}
              </p>
            }
          }
        </div>

        <div
          class="mt-3 rounded-lg border border-border p-2 flex items-center justify-between"
        >
          <span class="text-xs text-text-secondary">
            Equivalente declarado ({{ foreignCurrencyCode() }})
          </span>
          <span class="text-sm font-semibold text-text-primary">
            {{ foreignTotalLabel() }}
          </span>
        </div>
        @if (errors().foreign_total_amount; as err) {
          <p class="mt-1 text-xs text-error">{{ err }}</p>
        }
      }
    }
  `,
})
export class InvoiceSectionDivisaComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  readonly form = input.required<FormGroup>();
  readonly paths = input.required<DivisaSectionPaths>();
  readonly currencyOptions = input<SelectorOption[]>([]);
  readonly errors = input<{
    currency_code?: string;
    exchange_rate?: string;
    exchange_rate_date?: string;
    foreign_total_amount?: string;
  }>({});

  /** ¿Se declara conversión? Ambas páginas lo computan desde su propio control. */
  readonly usesForeignCurrency = input<boolean>(false);

  // ── Sólo contexto `invoice` ────────────────────────────────────────────
  readonly exchangeRateLoading = input<boolean>(false);
  readonly exchangeRateQuote = input<ExchangeRateQuote | null>(null);
  readonly exchangeRateOverridden = input<boolean>(false);
  readonly exchangeRateUnavailableReason = input<string>('');
  readonly foreignCurrencyCode = input<string>('');
  readonly foreignTotalLabel = input<string>('');
  readonly formatCurrency = input<(value: number) => string>((value) => String(value));

  readonly exchangeRateInputsChanged = output<void>();
  readonly applyOfficialExchangeRate = output<void>();

  readonly declareForeignControl = computed(
    () => requireControl(this.form(), this.paths().declare_foreign, SECTION) as FormControl,
  );
  readonly currencyCodeControl = computed(
    () => requireControl(this.form(), this.paths().currency_code, SECTION) as FormControl,
  );
  readonly exchangeRateControl = computed(() => {
    const path = this.paths().exchange_rate;
    return path ? (optionalControl(this.form(), path) as FormControl | null) : null;
  });
  readonly exchangeRateDateControl = computed(() => {
    const path = this.paths().exchange_rate_date;
    return path ? (optionalControl(this.form(), path) as FormControl | null) : null;
  });
}
