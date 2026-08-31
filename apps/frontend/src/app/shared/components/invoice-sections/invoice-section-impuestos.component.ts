import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';

import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import { SelectorComponent } from '../selector/selector.component';
import type { SelectorOption } from '../selector/selector.component';
import { ToggleComponent } from '../toggle/toggle.component';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

/**
 * Dónde vive cada campo de UNA regla de la matriz por porción (contexto
 * `profile`). Cada regla es su propio `FormGroup` dentro de `taxes`, y esta
 * sección la recibe como filas sueltas (`rows()[i]`), no como
 * `formGroupName` ambiental — el mismo motivo que en «Líneas» (B.3).
 */
export interface ImpuestosRowPaths {
  tax_code: string;
  bucket: string;
  rate: string;
  taxable: string;
}

/**
 * Una fila del desglose agregado de impuestos de línea (contexto `invoice`).
 * Espejo exacto de la forma que hoy produce `taxBreakdown()` en
 * `invoice-create-page.component.ts` — la sección no la calcula, sólo la
 * pinta: el agregado depende de las líneas y de `lineMath()`, que son del
 * dominio de la página, no de esta sección.
 */
export interface TaxBreakdownRow {
  readonly key: string;
  readonly name: string;
  readonly rate: number;
  readonly isInclusive: boolean;
  readonly base: number;
  readonly amount: number;
}

/**
 * Sección «Impuestos»: B.4 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Por qué esta sección NO fusiona los dos modelos
 *
 * El perfil declara una MATRIZ POR PORCIÓN (`taxes.rules`: qué tarifa grava
 * qué porción del contrato AIU o, fuera de AIU, la única porción «costo»).
 * La factura declara IMPUESTOS POR LÍNEA (cada renglón trae su propio
 * `taxes: FormArray`, ver B.3) y esta sección sólo PINTA el agregado
 * resultante (`taxBreakdown()`): de solo lectura, porque «el importe que se
 * envía es siempre cero y la DIAN recibe el que calcula el motor fiscal».
 *
 * El plan pide que «la factura gane la matriz igual, porque a partir de la
 * Fase C la puede editar» y que «los dos modelos conviven, no se fusionan».
 * Esta fase (B) es de EXTRACCIÓN, no de funcionalidad nueva: la matriz por
 * porción no tiene hoy ninguna fuente propia en la factura (`CreateInvoiceTaxDto`
 * no declara `bucket`, y no hay endpoint que la reciba), así que dibujarla
 * ahora habría sido inventar un contrato de datos que Fase C todavía no
 * define. Lo que SÍ se extrae es exactamente lo que cada página ya
 * renderiza hoy: la matriz editable del perfil, y el agregado de solo
 * lectura de la factura — sin tocar ninguno de los dos cálculos.
 *
 * ## Lo que la página sigue decidiendo
 *
 * - `rows`/`rowPaths`/opciones: sólo contexto `profile`. La página sigue
 *   dueña del `FormArray` `taxes` y de `addTaxRule()`/`removeTaxRule()`.
 * - `breakdown`/`formatCurrency`/`availableTaxesCount`: sólo contexto
 *   `invoice`. La página sigue dueña de `taxBreakdown()` y de
 *   `availableTaxes()`.
 */
@Component({
  selector: 'vendix-invoice-section-impuestos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    @if (isProfile()) {
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-text-secondary">Qué impuesto grava qué base.</p>
          <app-button variant="secondary" size="sm" (clicked)="addRule.emit()">
            <app-icon slot="icon" name="plus" [size]="14"></app-icon>
            Agregar impuesto
          </app-button>
        </div>
        <div class="space-y-2">
          @for (row of rows(); track row; let i = $index) {
            <div
              class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
            >
              <app-selector
                label="Impuesto"
                [formControl]="rowControl(row, rowPaths().tax_code)"
                [options]="taxCodeOptions()"
                size="sm"
              ></app-selector>
              <app-selector
                label="Base"
                [formControl]="rowControl(row, rowPaths().bucket)"
                [options]="bucketOptions()"
                size="sm"
              ></app-selector>
              <app-input
                label="Tarifa (%)"
                [formControl]="rowControl(row, rowPaths().rate)"
                [control]="rowControl(row, rowPaths().rate)"
                size="sm"
                [error]="rateErrors()[i]"
              ></app-input>
              <div class="flex items-center pb-2">
                <app-toggle
                  [formControl]="rowControl(row, rowPaths().taxable)"
                  label="Gravable"
                ></app-toggle>
              </div>
              <!--
                SÓLO EL ICONO, mismo criterio que en «Líneas» y «Retenciones»:
                el nombre accesible viaja en ariaLabel, no en texto repetido
                en cada fila de la matriz.
              -->
              <app-button
                variant="outline-danger"
                size="sm"
                ariaLabel="Quitar esta regla de impuesto"
                (clicked)="removeRule.emit(i)"
              >
                <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
              </app-button>
            </div>
          }
        </div>
      </div>
    } @else {
      <p class="text-xs text-text-secondary mb-2">
        Los impuestos se declaran POR LÍNEA, en la sección Líneas. Aquí se ve
        el agregado que el servidor va a recomputar: el importe que se envía
        es siempre cero y la DIAN recibe el que calcula el motor fiscal, no
        el que se escriba en pantalla.
      </p>

      @if (breakdown().length === 0) {
        <p class="text-sm text-text-secondary">
          Ninguna línea declara impuesto. Sólo es correcto si la operación es
          realmente excluida o exenta.
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-left text-text-secondary border-b border-border">
                <th class="py-1 pr-2">Impuesto</th>
                <th class="py-1 pr-2">Tarifa</th>
                <th class="py-1 pr-2">Aplicación</th>
                <th class="py-1 pr-2 text-right">Base</th>
                <th class="py-1 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              @for (row of breakdown(); track row.key) {
                <tr class="border-b border-border last:border-0">
                  <td class="py-1 pr-2 text-text-primary">{{ row.name }}</td>
                  <td class="py-1 pr-2">{{ row.rate }}%</td>
                  <td class="py-1 pr-2">
                    {{ row.isInclusive ? 'Incluido' : 'Adicional' }}
                  </td>
                  <td class="py-1 pr-2 text-right">
                    {{ formatCurrency()(row.base) }}
                  </td>
                  <td class="py-1 text-right font-medium">
                    {{ formatCurrency()(row.amount) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (availableTaxesCount() === 0) {
        <p class="mt-2 text-xs text-warning">
          El catálogo de impuestos de la tienda está vacío o no se pudo
          cargar. Configúralo en Ajustes → Impuestos.
        </p>
      }
    }
  `,
})
export class InvoiceSectionImpuestosComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  // ── Contexto `profile`: matriz editable por porción ──────────────────────
  readonly rows = input<readonly AbstractControl[]>([]);
  readonly rowPaths = input<ImpuestosRowPaths>({
    tax_code: 'tax_code',
    bucket: 'bucket',
    rate: 'rate',
    taxable: 'taxable',
  });
  readonly bucketOptions = input<SelectorOption[]>([]);
  readonly taxCodeOptions = input<SelectorOption[]>([]);
  /** Error de `rate` por fila, ya resuelto por la página (`issueFor`). */
  readonly rateErrors = input<readonly (string | undefined)[]>([]);
  readonly addRule = output<void>();
  readonly removeRule = output<number>();

  // ── Contexto `invoice`: agregado de línea, de solo lectura ───────────────
  readonly breakdown = input<readonly TaxBreakdownRow[]>([]);
  readonly formatCurrency = input<(value: number) => string>((value) =>
    String(value),
  );
  readonly availableTaxesCount = input<number>(0);

  rowControl(row: AbstractControl, path: string): FormControl {
    return row.get(path) as FormControl;
  }
}
