import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
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

/**
 * Paso 1 "Configuración" del wizard POP (QUI-647).
 *
 * Aparece SOLO cuando la orden no tiene configuración (sin proveedor/bodega):
 * el shell antepone [Configuración, Pago, (Recepción), Confirmación] y este
 * paso pide los mismos campos que el modal "Configurar orden de compra" del
 * header (proveedor, bodega, fecha orden, fecha entrega, método de envío).
 * Al avanzar al paso Pago la configuración ya quedó escrita en el carrito
 * (escritura en vivo igual que el modal — cada cambio se emite al padre, que
 * la persiste vía PopCartService), así el módulo queda "Configurado" y el
 * header muestra el proveedor elegido.
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

  // ── Cambios → el padre escribe en el carrito (igual que el modal) ────────
  readonly supplierChange = output<number | null | string>();
  readonly locationChange = output<number | null | string>();
  readonly orderDateChange = output<string>();
  readonly expectedDateChange = output<string>();
  readonly shippingMethodChange = output<string>();
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
  });

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

  ngOnInit(): void {
    // Semilla del formulario desde la config actual del carrito. El paso se
    // DESTRUYE y RECREA en cada apertura (contentEpoch del shell), así la
    // semilla es fresca por sesión del wizard. `emitEvent: false` evita
    // re-emitir cambios al padre con los mismos valores que ya escribió.
    this.form.setValue(
      {
        supplier: this.selectedSupplierId(),
        location: this.selectedLocationId(),
        orderDate: this.orderDate(),
        expectedDate: this.expectedDate(),
        shippingMethod: this.shippingMethod() || 'pickup',
      },
      { emitEvent: false },
    );
  }

  /**
   * Gate del shell: marca todo como tocado (enciende `.ng-invalid` + errores
   * inline) y devuelve si el paso es válido. Proveedor y bodega son los únicos
   * obligatorios; fechas y envío tienen default.
   */
  validate(): boolean {
    this.form.markAllAsTouched();
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

  onShippingMethodChange(value: string): void {
    this.shippingMethodChange.emit(value);
  }
}