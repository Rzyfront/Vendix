import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Observable, startWith } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
/**
 * Selector de cuenta PUC con búsqueda (5 por página). Se importa desde
 * `products` en vez de duplicarse: es el único traductor código↔id contra el
 * plan de cuentas, y una segunda copia de esa traducción es justo el fallo mudo
 * que ese componente existe para evitar. Merece subir a `shared/components`.
 */
import { AccountCodeSelectComponent } from '../../../products/components/account-code-select.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { TaxOption, TaxSelection } from '../../../../../../shared/components/tax-selector';

import { InvoiceLineTaxesComponent } from './invoice-line-taxes.component';
import {
  AIU_COMPONENT_OPTIONS,
  UNIT_CODE_DEFAULT,
  UNIT_CODE_OPTIONS,
} from './invoice-dian-catalogs';
import {
  computeLineMath,
  lineDiscountExceedsSubtotal,
  InvoiceLineMathInput,
} from '../../utils/invoice-line-math';

/**
 * Una línea de factura, tal como la devuelve la configuración avanzada.
 *
 * Es EXACTAMENTE el conjunto de campos que el `FormGroup` de una línea declara
 * en `invoice-create.component.ts`, menos `row_uid` — la identidad de la fila la
 * pone el padre, no este modal.
 */
export interface InvoiceCustomItemDraft {
  /** `null` ⇒ ítem personalizado: no existe ni se crea en el inventario. */
  product_id: number | null;
  product_name: string;
  description: string;
  quantity: number;
  unit_code: string;
  unit_price: number;
  discount_amount: number;
  taxes: TaxSelection[];
  account_code: string;
  aiu_component: string;
  /**
   * Escala del precio publicado del PRODUCTO resuelto
   * (`products.price_unit_quantity`, QUI-648). NO se captura aquí: el backend
   * no lo acepta del request —lo resuelve del catálogo a propósito—, así que
   * llega como dato adjunto al borrador, igual que `product_name`, y la
   * previsión de esta pantalla divide por él igual que el servidor.
   * Ausente (ítem personalizado, que no tiene producto) ⇒ divisor 1.
   */
  price_unit_quantity?: number | string | null;
}

/**
 * CONFIGURACIÓN AVANZADA DE UN ÍTEM — Y ALTA DE UN ÍTEM PERSONALIZADO.
 *
 * ─── QUÉ RESUELVE ───────────────────────────────────────────────────────────
 *
 * «Debo poder crear en vivo un ítem personalizado, agregarle uno o más impuestos
 * y toda la configuración que yo quiera de ese ítem; tener una opción de
 * configuración avanzada donde me abra un modal más grande».
 *
 * La fila de la tabla de líneas es una tira estrecha: cabe descripción,
 * cantidad, unidad, precio y descuento, y el resto (impuestos, cuenta PUC,
 * componente AIU) queda apretado contra el borde. Aquí cada campo tiene sitio,
 * y sobre todo hay una PREVISIÓN de la aritmética de la línea — base, impuesto
 * incluido, impuesto adicional y total— que en la tira no cabía.
 *
 * ─── LO QUE NO HACE, A PROPÓSITO ────────────────────────────────────────────
 *
 * **No crea un producto.** El inventario no se toca. El backend acepta una línea
 * con `product_id` ausente (`description` + `quantity` + `unit_price` es todo lo
 * que exige), así que la factura se emite igual y el catálogo del comerciante no
 * se llena de conceptos de una sola vez.
 *
 * **No calcula el impuesto definitivo.** `computeLineMath` es la MISMA función
 * que pinta la tabla de líneas y el panel de totales; los tres muestran la misma
 * previsión. El importe que se declara a la DIAN lo recalcula el servidor con
 * `Prisma.Decimal` y es el único que manda.
 */
@Component({
  selector: 'vendix-invoice-custom-item-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AccountCodeSelectComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    InvoiceLineTaxesComponent,
  ],
  template: `
    <app-modal
      [isOpen]="open()"
      size="xxl"
      [fullScreenOnMobile]="true"
      [title]="modalTitle()"
      subtitle="Todo lo que la línea puede declarar, con la previsión del renglón a la vista"
      (cancel)="close()"
    >
      <form [formGroup]="form" class="p-4 space-y-4">
        @if (isCustom()) {
          <div
            class="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--color-surface-secondary)] px-4 py-3"
          >
            <app-icon
              name="sparkles"
              [size]="16"
              class="mt-0.5 shrink-0 text-primary"
            />
            <p class="text-xs leading-relaxed text-text-primary">
              <strong>Ítem personalizado.</strong> No se crea nada en tu
              inventario: la línea viaja descrita a mano y la factura se emite
              igual. Úsalo para conceptos que facturas una vez —un ajuste, un
              servicio puntual, un cargo pactado— sin ensuciar el catálogo.
            </p>
          </div>
        } @else {
          <div
            class="flex items-center gap-2.5 rounded-xl border border-border bg-[var(--color-surface-secondary)] px-4 py-3"
          >
            <app-icon
              name="package"
              [size]="16"
              class="shrink-0 text-[var(--color-text-secondary)]"
            />
            <p class="text-xs leading-relaxed text-text-primary">
              Vinculada a <strong>{{ productName() }}</strong> de tu inventario.
              Lo que edites aquí afecta a ESTA factura; el producto no cambia.
            </p>
          </div>
        }

        <!-- ── Concepto ─────────────────────────────────────────── -->
        <section class="space-y-3">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            Concepto
          </h3>
          <app-textarea
            label="Descripción"
            formControlName="description"
            [control]="control('description')"
            [error]="descriptionError()"
            [required]="true"
            [rows]="2"
            placeholder="Lo que el adquiriente va a leer en el documento (cbc:Description)"
          ></app-textarea>
        </section>

        <!-- ── Medida y precio ──────────────────────────────────── -->
        <section class="space-y-3">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            Medida y precio
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <app-input
              label="Cantidad"
              type="number"
              formControlName="quantity"
              [control]="control('quantity')"
              [error]="quantityError()"
              [required]="true"
              min="0.0001"
              step="any"
            ></app-input>
            <app-selector
              label="Unidad de medida"
              formControlName="unit_code"
              [options]="unitCodeOptions"
            ></app-selector>
            <app-input
              label="Precio unitario"
              [currency]="true"
              formControlName="unit_price"
              [control]="control('unit_price')"
              [error]="unitPriceError()"
              [required]="true"
            ></app-input>
            <app-input
              label="Descuento de la línea"
              [currency]="true"
              formControlName="discount_amount"
              [control]="control('discount_amount')"
              [error]="discountError()"
              helperText="Importe, no porcentaje. Se resta antes de calcular el impuesto."
            ></app-input>
          </div>
        </section>

        <!-- ── Impuestos ────────────────────────────────────────── -->
        <section class="space-y-3">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            Impuestos
          </h3>
          <p class="text-xs text-[var(--color-text-secondary)]">
            Salen del catálogo de tu tienda, y puedes declarar varios en la misma
            línea (IVA + INC es lo normal en un restaurante). «Incl.» significa
            que ya está dentro del precio unitario; «Adic.», que se suma encima.
          </p>
          <vendix-invoice-line-taxes
            formControlName="taxes"
            [taxes]="taxes()"
          />
          @if (taxes().length === 0) {
            <p class="text-xs text-warning">
              El catálogo de impuestos de la tienda está vacío o no se pudo
              cargar. Configúralo en Ajustes → Impuestos.
            </p>
          }
        </section>

        <!-- ── Clasificación ────────────────────────────────────── -->
        <section class="space-y-3">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            Clasificación contable
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-account-code-select
              label="Cuenta PUC (opcional)"
              formControlName="account_code"
              placeholder="Mapeo automático de cuentas"
              helperText="Vacío ⇒ el mapeo automático de cuentas decide."
            ></app-account-code-select>
            @if (isAiu()) {
              <app-selector
                label="Componente AIU"
                formControlName="aiu_component"
                [options]="aiuComponentOptions"
                placeholder="Sin componente — costo reembolsable"
                helpText="Vacío = costo reembolsable del contrato: suma al valor del contrato y queda fuera de la base gravable."
              ></app-selector>
            }
          </div>
        </section>

        <!-- ── Previsión ────────────────────────────────────────── -->
        <section
          class="rounded-xl border border-border bg-[var(--color-surface-muted)] p-4"
        >
          <div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Subtotal
              </div>
              <div class="font-semibold tabular-nums">
                {{ formatCurrency(preview().gross) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Base gravable
              </div>
              <div class="font-semibold tabular-nums">
                {{ formatCurrency(preview().base) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Impuesto incluido
              </div>
              <div class="font-semibold tabular-nums">
                {{ formatCurrency(preview().taxInclusive) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Impuesto adicional
              </div>
              <div class="font-semibold tabular-nums">
                {{ formatCurrency(preview().taxAdditional) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Total de la línea
              </div>
              <div class="font-bold text-primary tabular-nums">
                {{ formatCurrency(preview().total) }}
              </div>
            </div>
          </div>
          <p class="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            Cifra de referencia. El servidor recalcula la línea con aritmética
            decimal y su resultado es el que se declara a la DIAN.
          </p>
        </section>

        @if (blockers().length > 0) {
          <div
            role="alert"
            class="rounded-xl border border-error bg-error-light p-3"
          >
            <div class="flex items-start gap-2">
              <app-icon name="alert-triangle" [size]="16" class="text-error" />
              <div class="min-w-0">
                <p class="text-sm font-semibold text-error">
                  La línea no se puede guardar todavía
                </p>
                <ul class="mt-1 list-disc pl-4 text-xs text-error space-y-0.5">
                  @for (blocker of blockers(); track blocker) {
                    <li>{{ blocker }}</li>
                  }
                </ul>
              </div>
            </div>
          </div>
        }
      </form>

      <div slot="footer">
        <div
          class="flex items-center justify-between gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border"
        >
          <span class="text-xs text-[var(--color-text-secondary)] min-w-0 truncate">
            {{ hint() }}
          </span>
          <div class="flex items-center gap-3 shrink-0">
            <app-button variant="outline" (clicked)="close()">
              Cancelar
            </app-button>
            <app-button variant="primary" (clicked)="submit()">
              {{ isEditing() ? 'Guardar cambios' : 'Agregar a la factura' }}
            </app-button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
})
export class InvoiceCustomItemModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly open = input<boolean>(false);
  /** Valores iniciales. `null` ⇒ ítem personalizado en blanco. */
  readonly draft = input<InvoiceCustomItemDraft | null>(null);
  /** Catálogo de impuestos de la tienda; lo carga el padre una sola vez. */
  readonly taxes = input<TaxOption[]>([]);
  /** El documento está declarado como AIU (09): la línea necesita componente. */
  readonly isAiu = input<boolean>(false);
  /** `true` cuando se edita una línea existente, `false` al crearla. */
  readonly isEditing = input<boolean>(false);

  readonly saved = output<InvoiceCustomItemDraft>();
  readonly closed = output<void>();

  readonly unitCodeOptions = UNIT_CODE_OPTIONS;
  readonly aiuComponentOptions = AIU_COMPONENT_OPTIONS;

  readonly form: FormGroup = this.fb.group({
    product_id: [null as number | null],
    product_name: [''],
    description: ['', [Validators.required]],
    quantity: [1, [Validators.required, Validators.min(0.0001)]],
    unit_code: [UNIT_CODE_DEFAULT],
    unit_price: [0, [Validators.required, Validators.min(0)]],
    discount_amount: [0, [Validators.min(0)]],
    taxes: [[] as TaxSelection[]],
    account_code: [''],
    aiu_component: [''],
  });

  /**
   * Puente formulario → señal. `form.value` es una propiedad plana: leerla
   * dentro de un `computed` lo congelaría en el estado inicial y la previsión
   * de la línea no se movería nunca.
   */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(
      startWith(this.form.value),
    ) as Observable<Record<string, unknown>>,
    { initialValue: this.form.value as Record<string, unknown> },
  );

  private readonly value = computed<InvoiceCustomItemDraft>(() => {
    this.formValue();
    return this.form.getRawValue() as InvoiceCustomItemDraft;
  });

  /**
   * La línea tal como la consume la aritmética: los valores del formulario MÁS
   * la escala del producto resuelto. Esa escala NO vive en el formulario a
   * propósito — el backend no la acepta del request — y llega por el borrador
   * que el padre pasa al abrir; sin ella, esta previsión enseñaría N veces el
   * importe que la tabla de líneas (que sí divide) va a declarar.
   */
  private readonly mathInput = computed<InvoiceLineMathInput>(() => ({
    ...this.value(),
    price_unit_quantity: this.draft()?.price_unit_quantity,
  }));

  readonly isCustom = computed(() => this.value().product_id == null);
  readonly productName = computed(() => this.value().product_name || 'el producto');

  readonly modalTitle = computed(() =>
    this.isEditing()
      ? 'Configuración avanzada de la línea'
      : 'Nuevo ítem personalizado',
  );

  readonly preview = computed(() => computeLineMath(this.mathInput()));

  readonly blockers = computed<string[]>(() => {
    const value = this.value();
    const rows: string[] = [];
    if (!String(value.description ?? '').trim()) {
      rows.push(
        'Falta la descripción. Es lo único que el adquiriente lee de esta línea en el documento.',
      );
    }
    if (!(Number(value.quantity) >= 0.0001)) {
      rows.push('La cantidad debe ser mayor que cero.');
    }
    if (!(Number(value.unit_price) >= 0)) {
      rows.push('El precio unitario no puede ser negativo.');
    }
    if (Number(value.discount_amount) < 0) {
      rows.push('El descuento no puede ser negativo.');
    }
    if (lineDiscountExceedsSubtotal(this.mathInput())) {
      rows.push(
        'El descuento iguala o supera el subtotal de la línea: quedaría en cero y la factura declararía un renglón que nadie cobra.',
      );
    }
    // NO se exige componente AIU. Dejarlo vacío es la porción de COSTO
    // reembolsable del contrato —la nómina del personal de aseo, los insumos— y
    // es lo que distingue un contrato AIU de una venta ordinaria: entra al valor
    // del contrato y no a la base gravable.
    //
    // Antes se exigía, y era una compuerta MÁS ESTRICTA QUE EL BACKEND:
    // `resolveAiuContext` sólo rechaza lo inverso (un componente en un
    // documento que no es AIU, `INVOICING_AIU_003`), y el propio contrato del
    // perfil tiene una cubeta `costo` con su regla de impuesto no gravable. Con
    // la exigencia puesta, la línea de costo no se podía capturar y por tanto un
    // contrato AIU real no se podía facturar por esta pantalla.
    return rows;
  });

  readonly hint = computed(() => {
    const blockers = this.blockers();
    if (blockers.length > 0) {
      return blockers.length === 1
        ? '1 dato pendiente antes de agregar la línea.'
        : `${blockers.length} datos pendientes antes de agregar la línea.`;
    }
    return 'Total de la línea: ' + this.formatCurrency(this.preview().total);
  });

  constructor() {
    // Abrir carga los valores. `untracked` porque `draft()` sólo se lee EN la
    // apertura: si se rastreara, cada `patchValue` del padre reescribiría lo que
    // el usuario está tecleando.
    effect(() => {
      if (!this.open()) return;
      untracked(() => this.hydrate(this.draft()));
    });
  }

  control(name: string): FormControl {
    return this.form.get(name) as FormControl;
  }

  descriptionError(): string | undefined {
    const control = this.form.get('description');
    return control?.touched && control.hasError('required')
      ? 'La descripción es obligatoria.'
      : undefined;
  }

  quantityError(): string | undefined {
    const control = this.form.get('quantity');
    return control?.touched && control.invalid
      ? 'Debe ser mayor que cero.'
      : undefined;
  }

  unitPriceError(): string | undefined {
    const control = this.form.get('unit_price');
    return control?.touched && control.invalid
      ? 'No puede ser negativo.'
      : undefined;
  }

  discountError(): string | undefined {
    if (lineDiscountExceedsSubtotal(this.mathInput())) {
      return 'Se come la línea entera.';
    }
    const control = this.form.get('discount_amount');
    return control?.touched && control.invalid
      ? 'No puede ser negativo.'
      : undefined;
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.blockers().length > 0) return;

    const value = this.value();
    this.saved.emit({
      product_id: value.product_id ?? null,
      product_name: String(value.product_name ?? ''),
      description: String(value.description ?? '').trim(),
      quantity: Number(value.quantity) || 0,
      unit_code: String(value.unit_code || UNIT_CODE_DEFAULT),
      unit_price: Number(value.unit_price) || 0,
      discount_amount: Number(value.discount_amount) || 0,
      taxes: Array.isArray(value.taxes) ? value.taxes : [],
      account_code: String(value.account_code ?? '').trim(),
      aiu_component: String(value.aiu_component ?? ''),
    });
  }

  close(): void {
    this.closed.emit();
  }

  private hydrate(draft: InvoiceCustomItemDraft | null): void {
    this.form.reset({
      product_id: draft?.product_id ?? null,
      product_name: draft?.product_name ?? '',
      description: draft?.description ?? '',
      quantity: draft?.quantity ?? 1,
      unit_code: draft?.unit_code || UNIT_CODE_DEFAULT,
      unit_price: draft?.unit_price ?? 0,
      discount_amount: draft?.discount_amount ?? 0,
      taxes: draft?.taxes ? [...draft.taxes] : [],
      account_code: draft?.account_code ?? '',
      aiu_component: draft?.aiu_component ?? '',
    });
  }
}
