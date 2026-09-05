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
import type { TaxOption } from '../tax-selector';
import { InvoiceLineTaxesComponent } from '../../../private/modules/store/invoicing/components/invoice-create/invoice-line-taxes.component';
import { remainingChars, showCharCounter } from '../../../private/modules/store/invoicing/utils/char-limit.util';
import { AIU_COMPONENTS } from '../../../core/utils/invoice-profile-config.contract';
import type {
  AiuLineComponent,
  AiuTaxableBasis,
} from '../../../core/utils/invoice-profile-config.contract';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

const NBSP_LABEL_FALLBACK = 'Vincular producto';

/**
 * Valores que el control de componente AIU puede llevar, para efectos de
 * gravabilidad. Es el conjunto literal del tipo `AiuLineComponent`, NO una
 * regla: quién grava lo sigue decidiendo `isAiuLineTaxable` sobre
 * `AIU_TAXABLE_BUCKETS_BY_BASIS`. Existe sólo para no dejar pasar una cadena
 * arbitraria del formulario a un input tipado.
 */
const AIU_LINE_COMPONENTS: readonly AiuLineComponent[] = [
  ...AIU_COMPONENTS,
  'contrato',
];

/**
 * Traduce el valor CRUDO del control de componente AIU al vocabulario del
 * contrato fiscal. Exportada —y no un método privado— para poder custodiarla
 * sin montar la sección entera, que arrastra `app-input` y con él el servicio
 * de moneda, `HttpClient` y la fachada de tenant.
 *
 * Todo lo que no esté en la lista (el control aún vacío, un `'costo'` que el
 * perfil usa para codificar «apagado», una cadena de una versión futura) cae a
 * `null`, que `isAiuLineTaxable` lee como la porción de COSTO reembolsable.
 */
export function resolveAiuLineComponent(raw: unknown): AiuLineComponent | null {
  const value = String(raw ?? '').trim();
  return AIU_LINE_COMPONENTS.find((component) => component === value) ?? null;
}

/**
 * Dónde vive cada campo DENTRO de cada fila (no en la raíz del formulario:
 * cada renglón es su propio `FormGroup`, alcanzado por `rows()[i]`).
 *
 * `aiu_field` es la única entrada que traduce NOMBRE, no ausencia: la factura
 * llama a este control `aiu_component` y el perfil `bucket` —MISMO concepto
 * («¿esta línea entra a la base AIU y con cuál componente?»), dos nombres que
 * sobreviven porque cada uno es el que el DTO de su propio destino espera
 * (ADR-2). Ninguna de las dos pantallas renombra su `formControlName`: el
 * componente compartido sólo sabe, por este mapa, cuál mirar.
 */
export interface LineasRowPaths {
  description: string;
  quantity: string;
  unit_code: string;
  unit_price: string;
  /** Sólo existe en contexto `invoice`. */
  discount_amount: string | null;
  aiu_field: string;
  /** Sólo existe en contexto `invoice`: `FormArray` de impuestos de la línea. */
  taxes: string | null;
}

/** Errores por campo de UNA fila, ya resueltos por la página. */
export interface LineasRowErrors {
  description?: string;
  quantity?: string;
  unit_code?: string;
  unit_price?: string;
  discount_amount?: string;
  aiu_field?: string;
}

/**
 * Sección «Líneas» / «Líneas modelo»: la tabla de renglones de un documento o
 * de su plantilla. B.3 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Por qué esta sección tiene DOS plantillas internas y no una sola con
 * banderas de campo
 *
 * A diferencia de «Documento», donde los dos contextos comparten casi toda la
 * disposición y sólo cambian controles sueltos, acá la REJILLA misma es
 * distinta: la factura arma dos grillas de 12 columnas más el panel de
 * impuestos de línea; el perfil arma una sola grilla de 7 columnas sin panel
 * de impuestos (los tributos de un perfil se declaran por PORCIÓN en la
 * sección «Impuestos», no por línea — B.4). Forzar una única rejilla con
 * clases condicionales en cada celda habría sido más difícil de leer que dos
 * bloques `@if (isInvoice()) {…} @else {…}» explícitos, y el propio plan lo
 * anticipa: «es donde la asimetría más se nota».
 *
 * ## Lo que la página sigue decidiendo
 *
 * - `carriesAiu`/`toggleAiu`: la factura codifica «no lleva AIU» como
 *   `aiu_component` VACÍO; el perfil lo codifica como `bucket === 'costo'`.
 *   Son dos codificaciones distintas del mismo estado, y unificarlas
 *   cambiaría snapshots ya persistidos. El componente no las conoce: recibe
 *   la LECTURA (`carriesAiu`) y la ORDEN DE CAMBIO (`toggleAiu`) ya resueltas.
 * - `rowErrors`/`rowSummaries`: dependen de `fieldError()`/`issueFor()` y de
 *   `lineMath()`, que son de cada pantalla.
 * - Abrir el picker de producto, el modal de línea avanzada y crear una línea
 *   desde cualquiera de los tres caminos: la página sigue dueña de esos
 *   modales: el componente sólo emite la intención.
 */
@Component({
  selector: 'vendix-invoice-section-lineas',
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
    InvoiceLineTaxesComponent,
  ],
  template: `
    <div class="space-y-2">
      @for (row of rows(); track row; let i = $index) {
        @if (isInvoice()) {
          <div
            class="rounded-lg border border-border bg-[var(--color-surface-secondary)] p-2 space-y-2"
          >
            <div class="grid grid-cols-12 gap-2 items-end">
              <div class="col-span-12 md:col-span-4">
                <app-input
                  label="Descripción"
                  [attr.data-control-name]="'description'"
                  [formControl]="rowControl(row, rowPaths().description)"
                  [control]="rowControl(row, rowPaths().description)"
                  [error]="errorsFor(i).description"
                  [required]="true"
                  [maxlength]="descriptionLimit()"
                  size="sm"
                ></app-input>
                @if (
                  descriptionLimit();
                  as limit
                ) {
                  @if (
                    showCharCounter(rowControl(row, rowPaths().description).value, limit)
                  ) {
                    <p
                      class="text-[10px] text-right leading-tight"
                      [class.text-destructive]="
                        remainingChars(rowControl(row, rowPaths().description).value, limit) <= 0
                      "
                      [class.text-text-secondary]="
                        remainingChars(rowControl(row, rowPaths().description).value, limit) > 0
                      "
                    >
                      {{ remainingChars(rowControl(row, rowPaths().description).value, limit) }}
                      caracteres restantes
                    </p>
                  }
                }
              </div>
              <div class="col-span-6 md:col-span-2">
                <app-input
                  label="Cantidad"
                  [attr.data-control-name]="'quantity'"
                  type="number"
                  [formControl]="rowControl(row, rowPaths().quantity)"
                  [control]="rowControl(row, rowPaths().quantity)"
                  [error]="errorsFor(i).quantity"
                  [required]="true"
                  min="0.0001"
                  step="any"
                  size="sm"
                ></app-input>
              </div>
              <div class="col-span-6 md:col-span-2">
                <app-selector
                  label="Unidad"
                  [attr.data-control-name]="'unit_code'"
                  [formControl]="rowControl(row, rowPaths().unit_code)"
                  [options]="unitCodeOptions() ?? []"
                  [errorText]="errorsFor(i).unit_code ?? ''"
                  size="sm"
                ></app-selector>
              </div>
              <div class="col-span-6 md:col-span-2">
                <app-input
                  label="Precio unitario"
                  [currency]="true"
                  [formControl]="rowControl(row, rowPaths().unit_price)"
                  [control]="rowControl(row, rowPaths().unit_price)"
                  [error]="errorsFor(i).unit_price"
                  [required]="true"
                  size="sm"
                ></app-input>
              </div>
              <div class="col-span-6 md:col-span-2">
                <app-input
                  label="Descuento"
                  [attr.data-control-name]="'discount_amount'"
                  [currency]="true"
                  [formControl]="rowControl(row, rowPaths().discount_amount!)"
                  [control]="rowControl(row, rowPaths().discount_amount!)"
                  [error]="errorsFor(i).discount_amount"
                  size="sm"
                ></app-input>
              </div>
            </div>

            <div class="grid grid-cols-12 gap-2 items-center">
              @if (showProductActions()) {
                <div class="col-span-12 md:col-span-5">
                  <button
                    type="button"
                    class="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-border hover:border-primary-600 transition-colors text-left"
                    (click)="openProductPicker.emit(row)"
                    title="Elegir producto para esta línea"
                    aria-label="Elegir producto para esta línea"
                  >
                    <app-icon name="package" [size]="14" />
                    <span class="flex-1 min-w-0 truncate">
                      {{ productLabel(row) }}
                    </span>
                  </button>
                </div>
              }

              @if (isAiu()) {
                <div class="col-span-8 md:col-span-5 flex items-center gap-2">
                  <div
                    class="flex shrink-0 items-center"
                    [title]="
                      carriesAiu()(row, i)
                        ? 'Esta línea lleva la base AIU configurada'
                        : 'Costo reembolsable: no entra a la base AIU'
                    "
                  >
                    <app-toggle
                      label="AIU"
                      ariaLabel="Aplicar la base AIU a esta línea"
                      [checked]="carriesAiu()(row, i)"
                      (changed)="toggleAiu()(row, i, $event)"
                    ></app-toggle>
                  </div>
                  @if (carriesAiu()(row, i)) {
                    <div class="min-w-0 flex-1">
                      <app-selector
                        [formControl]="rowControl(row, rowPaths().aiu_field)"
                        [options]="aiuComponentOptions()"
                        [errorText]="errorsFor(i).aiu_field ?? ''"
                        placeholder="Componente AIU"
                        size="sm"
                      ></app-selector>
                    </div>
                  } @else {
                    <span
                      class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-secondary)]"
                    >
                      Costo reembolsable — fuera de la base AIU
                    </span>
                  }
                </div>
              } @else {
                <div class="col-span-8 md:col-span-5">
                  <span class="text-xs text-[var(--color-text-secondary)]">
                    {{ rowSummaries()[i] }}
                  </span>
                </div>
              }

              <div class="col-span-4 md:col-span-2 flex justify-end gap-1">
                @if (showProductActions()) {
                  <button
                    type="button"
                    (click)="openAdvancedItem.emit(row)"
                    class="text-[var(--color-text-secondary)] hover:text-primary transition-colors p-1"
                    title="Configuración avanzada de la línea"
                    aria-label="Configuración avanzada de la línea"
                  >
                    <app-icon name="sliders-horizontal" [size]="16" />
                  </button>
                }
                <app-button
                  variant="outline-danger"
                  size="sm"
                  ariaLabel="Eliminar esta línea"
                  (clicked)="removeLine.emit(i)"
                >
                  <app-icon slot="icon" name="x" [size]="15"></app-icon>
                </app-button>
              </div>
            </div>

            <!--
              LOS IMPUESTOS OCUPAN SU PROPIA FILA, a ancho completo — ver el
              docblock original: compartían celda con el picker en cuatro de
              doce columnas y con dos o tres impuestos empujaban el disparador
              a otro renglón.
            -->
            <!--
              LA GRAVABILIDAD NO SE DECIDE ACÁ, SE REENVÍA.

              Antes esta línea mandaba un booleano —«no lleva componente»— y
              con eso el hijo acusaba de sub-declarar a toda línea marcada sin
              impuesto, incluidas Administración e Imprevistos, que bajo base
              'utilidad' están correctamente sin él. Ahora viajan los dos
              datos crudos (porción y base) y la decisión la toma
              isAiuLineTaxable, único punto donde vive la tabla.
            -->
            <vendix-invoice-line-taxes
              [formControl]="rowControl(row, rowPaths().taxes!)"
              [taxes]="availableTaxes()"
              [aiuLineComponent]="aiuLineComponentFor(row, i)"
              [aiuTaxableBasis]="isAiu() ? aiuTaxableBasis() : null"
            />
          </div>
        } @else {
          <div
            class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-7"
          >
            @if (isAiu()) {
              <div class="space-y-1">
                <div
                  class="flex items-center"
                  [title]="
                    carriesAiu()(row, i)
                      ? 'Esta línea lleva la base AIU configurada'
                      : 'Costo reembolsable: no entra a la base AIU'
                  "
                >
                  <app-toggle
                    label="AIU"
                    ariaLabel="Aplicar la base AIU a esta línea"
                    [checked]="carriesAiu()(row, i)"
                    (changed)="toggleAiu()(row, i, $event)"
                  ></app-toggle>
                </div>
                @if (carriesAiu()(row, i)) {
                  <app-selector
                    [formControl]="rowControl(row, rowPaths().aiu_field)"
                    [options]="aiuComponentOptions()"
                    size="sm"
                  ></app-selector>
                } @else {
                  <span class="block truncate text-[11px] text-text-secondary"
                    >Costo reembolsable</span
                  >
                }
              </div>
            }
            <div
              [class.md:col-span-2]="isAiu()"
              [class.md:col-span-3]="!isAiu()"
            >
              <app-input
                label="Descripción"
                [attr.data-control-name]="'description'"
                [formControl]="rowControl(row, rowPaths().description)"
                [control]="rowControl(row, rowPaths().description)"
                [maxlength]="descriptionLimit()"
                size="sm"
                [error]="errorsFor(i).description"
              ></app-input>
              @if (
                descriptionLimit();
                as limit
              ) {
                @if (
                  showCharCounter(rowControl(row, rowPaths().description).value, limit)
                ) {
                  <p
                    class="text-[10px] text-right leading-tight"
                    [class.text-destructive]="
                      remainingChars(rowControl(row, rowPaths().description).value, limit) <= 0
                    "
                    [class.text-text-secondary]="
                      remainingChars(rowControl(row, rowPaths().description).value, limit) > 0
                    "
                  >
                    {{ remainingChars(rowControl(row, rowPaths().description).value, limit) }}
                    caracteres restantes
                  </p>
                }
              }
            </div>
            <app-input
              label="Cantidad"
              [attr.data-control-name]="'quantity'"
              [formControl]="rowControl(row, rowPaths().quantity)"
              [control]="rowControl(row, rowPaths().quantity)"
              size="sm"
            ></app-input>
            <app-input
              label="Unidad"
              [attr.data-control-name]="'unit_code'"
              [formControl]="rowControl(row, rowPaths().unit_code)"
              [control]="rowControl(row, rowPaths().unit_code)"
              [maxlength]="4"
              size="sm"
              [error]="errorsFor(i).unit_code"
            ></app-input>
            <!--
              Precio en BLANCO = se teclea en cada factura. No es un campo de
              dinero con formato: es la cadena que viaja al snapshot, y darle
              formato de moneda acá la redondearía a dos decimales cuando el
              anexo admite seis en el precio unitario.
            -->
            <app-input
              label="Precio"
              [formControl]="rowControl(row, rowPaths().unit_price)"
              [control]="rowControl(row, rowPaths().unit_price)"
              size="sm"
              placeholder="Se teclea"
              [error]="errorsFor(i).unit_price"
            ></app-input>
            <app-button
              variant="outline-danger"
              size="sm"
              ariaLabel="Eliminar esta línea"
              (clicked)="removeLine.emit(i)"
            >
              <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
            </app-button>
          </div>
        }
      }
    </div>

    @if (rows().length === 0) {
      <p class="text-center py-4 text-sm text-[var(--color-text-secondary)]">
        {{ emptyStateText() }}
      </p>
    }

    <div class="flex flex-wrap justify-end gap-2 mt-4">
      @if (isInvoice()) {
        <!--
          TRES caminos a una línea, no uno — el comerciante pidió poder tanto
          buscar en su inventario como crear un producto personalizado; la
          línea en blanco queda para quien sólo quiere teclear.

          El primero se oculta cuando la superficie no tiene inventario detrás
          (showProductActions): un botón «Buscar en inventario» que no puede
          buscar nada es peor que no tenerlo.

          El segundo se oculta cuando la superficie no aporta nada por encima
          de la rejilla (showCustomItemAction): ver el docblock de esa entrada.
        -->
        @if (showProductActions()) {
          <app-button
            variant="outline"
            size="sm"
            type="button"
            (clicked)="addFromPicker.emit()"
            [disabled]="rows().length >= maxLines()"
          >
            <app-icon slot="icon" name="search" [size]="14" />
            Buscar en inventario
          </app-button>
        }
        @if (showCustomItemAction()) {
          <app-button
            variant="outline"
            size="sm"
            type="button"
            (clicked)="addCustomItem.emit()"
            [disabled]="rows().length >= maxLines()"
          >
            <app-icon slot="icon" name="sparkles" [size]="14" />
            Ítem personalizado
          </app-button>
        }
        <app-button
          variant="ghost"
          size="sm"
          type="button"
          (clicked)="addBlankLine.emit()"
          [disabled]="rows().length >= maxLines()"
        >
          <app-icon slot="icon" name="plus" [size]="14" />
          Línea en blanco
        </app-button>
      } @else {
        <app-button
          variant="secondary"
          size="sm"
          type="button"
          (clicked)="addBlankLine.emit()"
          [disabled]="rows().length >= maxLines()"
        >
          <app-icon slot="icon" name="plus" [size]="14" />
          Línea
        </app-button>
      }
    </div>
  `,
})
export class InvoiceSectionLineasComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly rows = input.required<readonly AbstractControl[]>();
  readonly rowPaths = input.required<LineasRowPaths>();

  readonly isAiu = input.required<boolean>();
  readonly aiuComponentOptions = input.required<SelectorOption[]>();

  /**
   * Base gravable AIU declarada por el documento o por el perfil. Decide qué
   * porciones entran a la base, y con eso cuáles pueden salir sin impuesto sin
   * estar sub-declarando.
   *
   * Por omisión `'aiu'` A PROPÓSITO, y no `null` ni requerida: bajo esa base
   * gravan las tres porciones y sólo el costo reembolsable queda fuera, que es
   * EXACTAMENTE la pregunta que este componente hacía antes («¿lleva
   * componente?»). Las superficies que todavía no la pasan —el editor de
   * perfiles de tienda, y las dos consolas de plataforma— siguen pintando lo
   * mismo carácter por carácter; sólo cambia el comportamiento de quien la
   * declara distinta.
   */
  readonly aiuTaxableBasis = input<AiuTaxableBasis>('aiu');
  /**
   * No nula SÓLO en contexto `invoice`: cuando llega, `unit_code` se pinta
   * como `app-selector` con este catálogo. Cuando es `null` (perfil), se
   * pinta como texto libre de 4 caracteres — el mismo control que ya tenía el
   * editor de perfiles, sin forzarlo a un catálogo que hoy no valida.
   */
  readonly unitCodeOptions = input<SelectorOption[] | null>(null);
  readonly descriptionLimit = input<number | null>(null);
  readonly rowErrors = input<readonly LineasRowErrors[]>([]);
  /** Sólo se pinta en contexto `invoice`, cuando la línea NO lleva AIU. */
  readonly rowSummaries = input<readonly string[]>([]);

  /**
   * Lectura y mutación de «¿esta línea lleva AIU?». No se resuelven aquí
   * porque cada pantalla codifica el estado «apagado» distinto —cadena vacía
   * en la factura, `'costo'` en el perfil— y porque encender la fila propone
   * el primer componente gravable de una BASE que cada pantalla lee de una
   * fuente distinta (ver el docblock de la clase).
   */
  readonly carriesAiu =
    input.required<(row: AbstractControl, index: number) => boolean>();
  readonly toggleAiu =
    input.required<(row: AbstractControl, index: number, on: boolean) => void>();

  /** Sólo se consume en contexto `invoice`. */
  readonly availableTaxes = input<TaxOption[]>([]);

  /**
   * Si la superficie tiene un INVENTARIO detrás del que elegir la línea.
   *
   * `true` por defecto —el riel de tienda, que nació con esto— y `false` en la
   * consola de plataforma: allí no hay productos, así que el botón «Buscar en
   * inventario», el disparador de producto por fila y la configuración
   * avanzada de la línea no tienen a dónde llevar. Se ocultan en vez de
   * quedarse pintados sin manejador, que es como estaban.
   */
  readonly showProductActions = input<boolean>(true);

  /**
   * Si la superficie ofrece el camino «Ítem personalizado» (un modal aparte
   * para capturar la línea antes de meterla en la rejilla).
   *
   * `true` por defecto —el riel de tienda, que nació con esto y sigue igual— y
   * `false` en la consola de plataforma: allí el modal sólo aportaba poder
   * marcar el impuesto como incluido, y eso ya se hace en la propia fila desde
   * que la línea nueva nace con impuesto declarado. Un segundo camino que
   * termina en lo mismo es una decisión de más para el operador.
   */
  readonly showCustomItemAction = input<boolean>(true);

  readonly maxLines = input<number>(100);
  readonly emptyStateText = input.required<string>();

  readonly addBlankLine = output<void>();
  readonly addFromPicker = output<void>();
  readonly addCustomItem = output<void>();
  readonly openProductPicker = output<AbstractControl>();
  readonly openAdvancedItem = output<AbstractControl>();
  readonly removeLine = output<number>();

  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  /** F.3: contador de caracteres, expuesto para la plantilla. */
  readonly remainingChars = remainingChars;
  readonly showCharCounter = showCharCounter;

  rowControl(row: AbstractControl, path: string): FormControl {
    return row.get(path) as FormControl;
  }

  errorsFor(index: number): LineasRowErrors {
    return this.rowErrors()[index] ?? {};
  }

  /**
   * Qué porción del AIU declara ESTA fila, en el vocabulario del contrato
   * fiscal y no en el del formulario.
   *
   * El estado «apagado» sigue leyéndose por `carriesAiu()` y no por el valor
   * del control, porque cada pantalla lo codifica distinto (cadena vacía en la
   * factura, `'costo'` en el perfil) y ese es justamente el conocimiento que
   * este componente no tiene. Apagado significa `null`, que
   * `isAiuLineTaxable` traduce al bucket `'costo'`.
   *
   * Un valor que no esté en la lista —el control vacío mientras el operador
   * aún no elige— vuelve a `null` en vez de propagarse: preferimos tratar la
   * fila como costo reembolsable a mandar una cadena suelta a un input tipado.
   */
  aiuLineComponentFor(
    row: AbstractControl,
    index: number,
  ): AiuLineComponent | null {
    if (!this.isAiu() || !this.carriesAiu()(row, index)) return null;
    return resolveAiuLineComponent(row.get(this.rowPaths().aiu_field)?.value);
  }

  /** Sólo tiene sentido en contexto `invoice`: el perfil no vincula producto. */
  productLabel(row: AbstractControl): string {
    const name = row.get('product_name')?.value as string | null;
    return name || NBSP_LABEL_FALLBACK;
  }
}
