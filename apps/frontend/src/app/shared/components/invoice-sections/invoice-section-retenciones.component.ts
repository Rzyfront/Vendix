import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';

import { AlertBannerComponent } from '../alert-banner/alert-banner.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import { SelectorComponent } from '../selector/selector.component';
import type { SelectorOption } from '../selector/selector.component';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

/**
 * Dónde vive cada campo de UNA fila de retención. `base` sólo existe en
 * contexto `invoice`: el perfil no la guarda —«la BASE no se guarda: es el
 * importe de cada documento y se calcula al emitir»—, así que un perfil no
 * tiene control que mapear ahí.
 */
export interface RetencionesRowPaths {
  concept_id: string;
  role: string;
  rate: string;
  /** Sólo existe en contexto `invoice`. */
  base: string | null;
}

/** Errores por campo de UNA fila, ya resueltos por la página (`issueFor`). */
export interface RetencionesRowErrors {
  concept_id?: string;
  rate?: string;
}

/**
 * Sección «Retenciones»: B.5 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Lo que esta sección NO cubre
 *
 * El interruptor «importe manual» y su input de monto totales son de la
 * FACTURA únicamente y no tienen ningún equivalente en el perfil —un perfil
 * no emite, sólo precarga conceptos—, así que se quedan FUERA de este
 * componente, en la página, que sólo lo monta cuando `!isManualWithholding()`.
 * Forzarlos adentro habría inflado la sección compartida con una rama que
 * una de las dos páginas nunca usa.
 *
 * ## Asimetría de campos
 *
 * El perfil declara concepto, lado y tarifa; la factura además declara la
 * BASE gravable y pinta el importe retenido ya calculado por fila. Dos
 * plantillas internas por contexto, mismo criterio que «Líneas» (B.3) y
 * «Impuestos» (B.4): la rejilla misma cambia, no sólo clases sueltas.
 *
 * ## Lo que la página sigue decidiendo
 *
 * - `rowErrors`/`catalogRateFor`: sólo `profile` (dependen de `issueFor` y
 *   del catálogo de conceptos cargado en la página).
 * - `incompleteRowNumber`/`rowAmounts`/`formatCurrency`/`totalWithheld`:
 *   sólo `invoice` (dependen de `withholdingsValue()`/`effectiveWithholding()`,
 *   que son del dominio de la página).
 * - `exportWarningText`: las dos, pero cada una decide su propio gateo —la
 *   factura la muestra siempre que el documento es de exportación; el
 *   perfil sólo si además ya hay filas— y su propio texto.
 */
@Component({
  selector: 'vendix-invoice-section-retenciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    @if (exportWarningText(); as warning) {
      <p class="mb-2 flex items-start gap-1.5 text-xs text-warning">
        <app-icon
          name="alert-triangle"
          [size]="14"
          class="mt-0.5 shrink-0"
        ></app-icon>
        <span>{{ warning }}</span>
      </p>
    }

    @if (isProfile()) {
      @if (rows().length === 0) {
        <p class="text-xs text-text-secondary italic">
          {{ emptyStateText() }}
        </p>
      }
      <div class="space-y-2">
        @for (row of rows(); track row; let i = $index) {
          <div
            class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-6"
          >
            <div class="md:col-span-3">
              <app-selector
                label="Concepto"
                [formControl]="rowControl(row, rowPaths().concept_id)"
                [options]="conceptOptions()"
                size="sm"
                placeholder="Elige el concepto"
                [errorText]="rowErrors()[i]?.concept_id ?? ''"
              ></app-selector>
            </div>
            <app-selector
              label="Lado"
              [formControl]="rowControl(row, rowPaths().role)"
              [options]="roleOptions()"
              size="sm"
            ></app-selector>
            <app-input
              label="Tarifa %"
              [formControl]="rowControl(row, rowPaths().rate)"
              [control]="rowControl(row, rowPaths().rate)"
              size="sm"
              [helperText]="
                catalogRateFor()(i) ? 'Catálogo: ' + catalogRateFor()(i) + ' %' : ''
              "
              [error]="rowErrors()[i]?.rate ?? ''"
            ></app-input>
            <!--
              SÓLO EL ICONO, mismo criterio que en «Líneas» e «Impuestos»: el
              nombre accesible viaja en ariaLabel.
            -->
            <app-button
              variant="outline-danger"
              size="sm"
              ariaLabel="Quitar este concepto de retención"
              (clicked)="removeWithholding.emit(i)"
            >
              <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
            </app-button>
          </div>
        }
      </div>
      <div class="mt-2 flex justify-end">
        <app-button
          variant="secondary"
          size="sm"
          (clicked)="addWithholding.emit()"
        >
          <app-icon slot="icon" name="plus" [size]="14"></app-icon>
          Retención
        </app-button>
      </div>
    } @else {
      @if (conceptOptions().length === 0) {
        <app-alert-banner
          class="mb-3"
          variant="warning"
          icon="alert-triangle"
          tone="token"
        >
          No hay conceptos de retención configurados. Créalos en
          <span class="font-medium">Contabilidad › Retenciones</span> o activa
          el importe manual de arriba: sin concepto, el desglose no se puede
          guardar.
        </app-alert-banner>
      }

      <div class="space-y-2">
        @for (row of rows(); track row; let i = $index) {
          <div
            class="rounded-lg border border-border bg-surface p-3"
          >
            <div class="grid grid-cols-12 gap-2.5">
              <div class="col-span-12 md:col-span-7">
                <app-selector
                  label="Concepto"
                  [formControl]="rowControl(row, rowPaths().concept_id)"
                  [options]="conceptOptions()"
                  [searchable]="true"
                  placeholder="Busca el concepto de retención…"
                  size="sm"
                  (valueChange)="conceptChange.emit(i)"
                ></app-selector>
              </div>
              <div class="col-span-12 md:col-span-5">
                <app-selector
                  label="Lado de la operación"
                  [formControl]="rowControl(row, rowPaths().role)"
                  [options]="roleOptions()"
                  size="sm"
                ></app-selector>
              </div>
              <div class="col-span-5 md:col-span-3">
                <app-input
                  label="Tarifa %"
                  type="number"
                  [formControl]="rowControl(row, rowPaths().rate)"
                  [control]="rowControl(row, rowPaths().rate)"
                  min="0"
                  max="100"
                  step="any"
                  size="sm"
                ></app-input>
              </div>
              <div class="col-span-7 md:col-span-5">
                <app-input
                  label="Base gravable"
                  [currency]="true"
                  [formControl]="baseControl(row)"
                  [control]="baseControl(row)"
                  size="sm"
                ></app-input>
              </div>
              <div
                class="col-span-12 md:col-span-4 flex items-end justify-between gap-2 pb-0.5"
              >
                <div class="min-w-0">
                  <span
                    class="block text-[10px] uppercase tracking-wide text-text-secondary"
                  >
                    Retenido
                  </span>
                  <span
                    class="block text-sm font-semibold text-text-primary truncate"
                  >
                    {{ formatCurrency()(rowAmounts()[i] ?? 0) }}
                  </span>
                </div>
                <app-button
                  variant="outline-danger"
                  size="sm"
                  ariaLabel="Quitar este concepto de retención"
                  (clicked)="removeWithholding.emit(i)"
                >
                  <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
                </app-button>
              </div>
            </div>

            @if (incompleteRowNumber() === i + 1) {
              <p class="mt-3 flex items-center gap-1.5 text-[11px] text-warning">
                <app-icon name="alert-circle" [size]="12"></app-icon>
                Falta concepto, tarifa o base. La factura no se envía con una
                retención a medias.
              </p>
            }
          </div>
        } @empty {
          <p
            class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-secondary"
          >
            {{ emptyStateText() }}
          </p>
        }
      </div>

      <div
        class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <app-button
          variant="outline"
          size="sm"
          type="button"
          (clicked)="addWithholding.emit()"
        >
          <app-icon slot="icon" name="plus" [size]="14"></app-icon>
          Agregar retención
        </app-button>
        <div
          class="flex items-baseline justify-between gap-2 rounded-lg bg-surface-hover px-3 py-2 sm:justify-end"
        >
          <span class="text-xs text-text-secondary">Total retenido</span>
          <span class="text-sm font-semibold text-text-primary">
            {{ formatCurrency()(totalWithheld()) }}
          </span>
        </div>
      </div>
    }
  `,
})
export class InvoiceSectionRetencionesComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  readonly rows = input<readonly AbstractControl[]>([]);
  readonly rowPaths = input<RetencionesRowPaths>({
    concept_id: 'concept_id',
    role: 'role',
    rate: 'rate',
    base: null,
  });
  readonly conceptOptions = input<SelectorOption[]>([]);
  readonly roleOptions = input<SelectorOption[]>([]);
  readonly emptyStateText = input<string>('');
  /** Texto del aviso de exportación, o `null` para no pintarlo. Cada página decide su propio gateo. */
  readonly exportWarningText = input<string | null>(null);

  // ── Sólo contexto `profile` ───────────────────────────────────────────
  readonly rowErrors = input<readonly RetencionesRowErrors[]>([]);
  readonly catalogRateFor = input<(index: number) => string | null>(
    () => null,
  );

  // ── Sólo contexto `invoice` ────────────────────────────────────────────
  readonly incompleteRowNumber = input<number>(0);
  readonly rowAmounts = input<readonly number[]>([]);
  readonly totalWithheld = input<number>(0);
  readonly formatCurrency = input<(value: number) => string>((value) =>
    String(value),
  );

  readonly addWithholding = output<void>();
  readonly removeWithholding = output<number>();
  /**
   * Sólo se usa hoy en `invoice`: elegir un concepto rellena tarifa y
   * etiqueta desde el catálogo (`onWithholdingConceptChange`). El perfil no
   * escucha este output porque su fila no se autocompleta desde ningún
   * catálogo de conceptos ya elegidos por el usuario.
   */
  readonly conceptChange = output<number>();

  rowControl(row: AbstractControl, path: string): FormControl {
    return row.get(path) as FormControl;
  }

  /** `rowPaths().base` sólo existe en `invoice`; ahí nunca es `null`. */
  baseControl(row: AbstractControl): FormControl {
    return row.get(this.rowPaths().base ?? 'base') as FormControl;
  }
}
