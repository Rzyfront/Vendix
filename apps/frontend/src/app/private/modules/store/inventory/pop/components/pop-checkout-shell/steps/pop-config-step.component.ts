import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../../shared/components/selector/selector.component';
import { InputComponent } from '../../../../../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { ToggleComponent } from '../../../../../../../../shared/components/toggle/toggle.component';
import { PopShippingAllocation } from '../../../interfaces';

/**
 * Paso 1 "Configuración" del wizard POP (QUI-647).
 *
 * Pide los mismos campos que el modal "Configurar orden de compra" del header
 * (proveedor, bodega, fecha orden, fecha entrega, método de envío) y —desde
 * CP-PURCHASE-TRANSPARENCY C.5— el FLETE y su imputación cuando el método de
 * entrega es «Flete». Al avanzar al paso Pago la configuración ya quedó escrita
 * en el carrito (escritura en vivo igual que el modal — cada cambio se emite al
 * padre, que la persiste vía PopCartService), así el módulo queda "Configurado"
 * y el header muestra el proveedor elegido.
 *
 * Presentacional como `pop-order-config-modal`: recibe opciones + valores
 * actuales y emite cambios; el que escribe es `pop.component` (vía
 * `PopCartService`). Reactive forms OBLIGATORIO (no ngModel): `focusFirstInvalid`
 * del shell depende de `.ng-invalid` que el formulario reactivo aplica a los
 * controles. El puente `statusChanges → toSignal` (patrón pop-payment-step)
 * hace que las computeds de error se re-evalúen sin NgZone.
 */
@Component({
  selector: 'app-pop-config-step',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SelectorComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    ToggleComponent,
  ],
  templateUrl: './pop-config-step.component.html',
  styleUrl: './pop-config-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopConfigStepComponent {
  // ── Opciones + valores actuales (dueño: pop.component / pop-header) ──────
  readonly supplierOptions = input<SelectorOption[]>([]);
  readonly locationOptions = input<SelectorOption[]>([]);
  readonly shippingMethodOptions = input<SelectorOption[]>([]);
  readonly selectedSupplierId = input<number | null>(null);
  readonly selectedLocationId = input<number | null>(null);
  readonly orderDate = input('');
  readonly expectedDate = input('');
  readonly shippingMethod = input('');
  readonly minExpectedDate = input('');
  /** C.5 — flete capturado en el carrito (0 cuando no hay flete). */
  readonly shippingCost = input(0);
  /** C.5 — imputación vigente. `undefined` mientras el flete sea cero. */
  readonly shippingCostAllocation = input<PopShippingAllocation | undefined>(
    undefined,
  );

  // ── Cambios → el padre escribe en el carrito (igual que el modal) ────────
  readonly supplierChange = output<number | null | string>();
  readonly locationChange = output<number | null | string>();
  readonly orderDateChange = output<string>();
  readonly expectedDateChange = output<string>();
  readonly shippingMethodChange = output<string>();
  readonly shippingCostChange = output<number>();
  readonly shippingCostAllocationChange = output<PopShippingAllocation>();
  readonly openSupplierModal = output<void>();
  readonly openWarehouseModal = output<void>();

  // ── Formulario reactivo (gate del shell: `.ng-invalid` para focusFirstInvalid) ──
  readonly form = new FormGroup({
    supplier: new FormControl<number | string | null>(null, {
      validators: [Validators.required],
    }),
    location: new FormControl<number | string | null>(null, {
      validators: [Validators.required],
    }),
    orderDate: new FormControl<string>(''),
    expectedDate: new FormControl<string>(''),
    shippingMethod: new FormControl<string>('pickup'),
    /**
     * C.5 — el CVA de `app-input [currency]` escribe el NÚMERO crudo, no la
     * cadena que se pinta; por eso el control admite los dos tipos.
     * `Validators.min(0)` rechaza el flete negativo en el cliente; el servidor
     * lo vuelve a rechazar con `@Min(0)` (nunca se confía sólo en la pantalla).
     */
    shippingCost: new FormControl<number | string | null>(0, {
      validators: [Validators.min(0)],
    }),
  });

  /**
   * Espejo en signal del método de envío elegido.
   *
   * No se puentea con `valueChanges`: la semilla de `ngOnInit` usa
   * `emitEvent: false` (para no re-emitir al padre lo que ya escribió), así que
   * un `toSignal(valueChanges)` se quedaría con el 'pickup' del constructor y
   * el campo de flete no aparecería al reabrir una orden que YA lleva flete.
   */
  private readonly shippingMethodValue = signal<string>('pickup');

  /** C.5 — imputación elegida en el conmutador. Por defecto: prorratear. */
  private readonly allocation = signal<PopShippingAllocation>('prorate');

  /**
   * El campo de flete existe SÓLO cuando la entrega es por flete. Pintarlo
   * siempre haría que el operador capturara flete en compras de mostrador,
   * inflando el costo del inventario.
   */
  readonly isFreight = computed<boolean>(
    () => this.shippingMethodValue() === 'freight',
  );

  /** True cuando el conmutador está en «Prorratear». */
  readonly isProrate = computed<boolean>(() => this.allocation() === 'prorate');

  /**
   * Leyenda del conmutador. Es una explicación de NEGOCIO, no de contabilidad:
   * dice qué le pasa al costo del producto y qué le pasa al total de la orden,
   * que es la duda inmediata del operador.
   */
  readonly allocationLegend = computed<string>(() =>
    this.isProrate()
      ? 'El flete se reparte entre los productos según su participación en la compra, así que cada producto queda valorado con lo que realmente costó ponerlo en bodega: sube su costo unitario y con él el margen que calcula el sistema. El flete se suma al total de la orden.'
      : 'El flete no toca el costo de los productos: se registra como un costo de la orden y el costo unitario no se mueve. El flete se suma igual al total de la orden.',
  );

  /**
   * Puente zoneless (patrón pop-payment-step): el status de un ReactiveForm es
   * una propiedad plana; `toSignal(statusChanges)` re-evalúa las computeds que
   * leen `formStatus()` ante cualquier cambio de valor o marcado (touched).
   */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  /** Error inline del proveedor (solo tras intentar avanzar). */
  readonly supplierError = computed<string>(() => {
    this.formStatus();
    const c = this.form.controls.supplier;
    return c.invalid && c.touched ? 'Selecciona el proveedor' : '';
  });

  /** Error inline de la bodega (solo tras intentar avanzar). */
  readonly locationError = computed<string>(() => {
    this.formStatus();
    const c = this.form.controls.location;
    return c.invalid && c.touched ? 'Selecciona la bodega' : '';
  });

  /** Error inline del flete: negativo o no numérico. */
  readonly shippingCostError = computed<string>(() => {
    this.formStatus();
    const c = this.form.controls.shippingCost;
    if (!this.isFreight()) return '';
    if (c.hasError('min')) return 'El flete no puede ser negativo.';
    return c.invalid && c.touched ? 'Escribe un monto de flete válido.' : '';
  });

  ngOnInit(): void {
    // Semilla del formulario desde la config actual del carrito. El paso se
    // DESTRUYE y RECREA en cada apertura (contentEpoch del shell), así la
    // semilla es fresca por sesión del wizard. `emitEvent: false` evita
    // re-emitir cambios al padre con los mismos valores que ya escribió.
    const method = this.shippingMethod() || 'pickup';
    this.form.setValue(
      {
        supplier: this.selectedSupplierId(),
        location: this.selectedLocationId(),
        orderDate: this.orderDate(),
        expectedDate: this.expectedDate(),
        shippingMethod: method,
        shippingCost: this.shippingCost() || 0,
      },
      { emitEvent: false },
    );
    this.shippingMethodValue.set(method);
    this.allocation.set(this.shippingCostAllocation() ?? 'prorate');
  }

  /**
   * Gate del shell: marca todo como tocado (enciende `.ng-invalid` + errores
   * inline) y devuelve si el paso es válido. Proveedor y bodega son los únicos
   * obligatorios; fechas y envío tienen default. El flete sólo puede fallar por
   * negativo, y sólo cuando el método es flete.
   */
  validate(): boolean {
    this.form.markAllAsTouched();
    if (!this.isFreight()) return this.form.controls.supplier.valid && this.form.controls.location.valid;
    return this.form.valid;
  }

  // ── Forward al padre (escribe en el carrito en vivo) ─────────────────────
  onSupplierChange(value: number | null | string): void {
    this.supplierChange.emit(value);
  }

  onLocationChange(value: number | null | string): void {
    this.locationChange.emit(value);
  }

  onOrderDateChange(value: string): void {
    this.orderDateChange.emit(value);
  }

  onExpectedDateChange(value: string): void {
    this.expectedDateChange.emit(value);
  }

  /**
   * `app-selector` emits `string | number | null`; el paso de configuración
   * solo maneja códigos de método de envío en string, así que se normaliza.
   *
   * C.5 — al salir de «Flete» el monto se limpia EN LA PANTALLA y se emite el
   * cero al padre. Sin esto quedaba un flete fantasma: el campo desaparecía y
   * el monto seguía viajando al preview y al costo sellado.
   */
  onShippingMethodChange(value: string | number | null): void {
    const method = value == null ? '' : String(value);
    this.shippingMethodValue.set(method);
    this.shippingMethodChange.emit(method);
    if (method !== 'freight') {
      this.form.controls.shippingCost.setValue(0, { emitEvent: false });
      this.shippingCostChange.emit(0);
    }
  }

  /**
   * `app-input [currency]` emite el número canónico serializado (A.14), nunca
   * el texto con separadores de miles. `''` es el campo vacío ⇒ flete cero.
   */
  onShippingCostChange(raw: string): void {
    const value = raw === '' ? 0 : Number(raw);
    const safe = Number.isFinite(value) && value > 0 ? value : 0;
    this.shippingCostChange.emit(safe);
    // Al aparecer el flete hay que declarar su modo o el backend responde 400.
    // Se emite el que muestra el conmutador para que carrito y pantalla no
    // puedan divergir.
    if (safe > 0) this.shippingCostAllocationChange.emit(this.allocation());
  }

  /** Conmutador: encendido = prorratear, apagado = asumirlo como costo. */
  onAllocationToggle(prorate: boolean): void {
    const mode: PopShippingAllocation = prorate ? 'prorate' : 'expense';
    this.allocation.set(mode);
    this.shippingCostAllocationChange.emit(mode);
  }
}
