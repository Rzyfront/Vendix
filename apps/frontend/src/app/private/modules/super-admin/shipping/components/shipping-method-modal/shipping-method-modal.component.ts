import {Component, OnInit, inject, input, output, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ShippingService } from '../../services/shipping.service';
import { ShippingMethod, ShippingMethodType } from '../../interfaces/shipping.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-superadmin-shipping-method-modal',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, ButtonComponent, ModalComponent, InputComponent, ToggleComponent, SelectorComponent],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="(method() ? 'Editar' : 'Nuevo') + ' Método de Envío del Sistema'"
      [subtitle]="'Configura los detalles de la opción de entrega del sistema'"
      (closed)="close.emit()"
      size="md"
      >
      <div slot="header">
        <div class="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center border border-[var(--color-primary)]/20">
          <app-icon name="truck" size="20" class="text-[var(--color-primary)]"></app-icon>
        </div>
      </div>
    
      <form [formGroup]="form" id="shippingMethodForm" (ngSubmit)="onSubmit()" class="space-y-4">
        <app-input
          label="Nombre del Método"
          formControlName="name"
          placeholder="Ej: Envío Estándar Nacional"
          [required]="true"
        ></app-input>
    
        <app-selector
          label="Tipo de Logística"
          formControlName="type"
          [options]="typeOptions"
          [required]="true"
        ></app-selector>
    
        @if (showProviderField) {
          <app-input
            label="Nombre del Proveedor"
            formControlName="provider_name"
            placeholder="Ej: Fedex, Servientrega..."
            class="animate-in slide-in-from-top-2 duration-200"
          ></app-input>
        }
    
        <div class="grid grid-cols-2 gap-4">
          <app-input
            label="Días Mínimos"
            type="number"
            formControlName="min_days"
            placeholder="0"
            helperText="Días"
          ></app-input>
          <app-input
            label="Días Máximos"
            type="number"
            formControlName="max_days"
            placeholder="5"
            helperText="Días"
          ></app-input>
        </div>

        <app-input
          label="Tiempo de tránsito (minutos)"
          type="number"
          formControlName="transit_time_minutes"
          placeholder="Ej: 120"
          helperText="Tiempo estimado de tránsito en minutos"
        ></app-input>
    
        <div class="flex items-center justify-between p-4 rounded-xl border border-[var(--color-border)] bg-gray-50/30 mt-6">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center border border-green-100">
              <app-icon name="check" size="16" class="text-green-600"></app-icon>
            </div>
            <div>
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado Activo</span>
              <p class="text-xs text-[var(--color-text-secondary)]">Visible para todas las tiendas.</p>
            </div>
          </div>
          <app-toggle formControlName="is_active"></app-toggle>
        </div>
      </form>
    
      <div slot="footer" class="flex items-center justify-end gap-3 w-full">
        <app-button variant="ghost" (clicked)="close.emit()">
          Cancelar
        </app-button>
        <app-button variant="primary" [loading]="isSubmitting()" [disabled]="form.invalid" (clicked)="onSubmit()">
          <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
          {{ method() ? 'Actualizar Método' : 'Crear Método' }}
        </app-button>
      </div>
    </app-modal>
    `
})
export class ShippingMethodModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  readonly method = input<ShippingMethod>();
  readonly close = output<void>();
  readonly saved = output<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingService);

  ShippingMethodType = ShippingMethodType;
  form: FormGroup;
  readonly isSubmitting = signal(false);

  typeOptions: SelectorOption[] = [
    { value: ShippingMethodType.PICKUP, label: 'Recogida en Tienda' },
    { value: ShippingMethodType.OWN_FLEET, label: 'Flota Propia' },
    { value: ShippingMethodType.CARRIER, label: 'Transportadora' },
    { value: ShippingMethodType.THIRD_PARTY_PROVIDER, label: 'Proveedor Externo' },
    { value: ShippingMethodType.CUSTOM, label: 'Personalizado' },
  ];

  constructor() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      type: [ShippingMethodType.CUSTOM, Validators.required],
      provider_name: [''],
      min_days: [null],
      max_days: [null],
      transit_time_minutes: [null],
      is_active: [true],
    });
  }

  ngOnInit() {
    const method = this.method();
    if (method) {
      this.form.patchValue(method);
    }
  }

  get showProviderField(): boolean {
    const type = this.form.get('type')?.value;
    return type === ShippingMethodType.CARRIER || type === ShippingMethodType.THIRD_PARTY_PROVIDER;
  }

  async onSubmit() {
    if (this.form.invalid) return;

    this.isSubmitting.set(true);
    const value = this.form.value;

    const method = this.method();
    const request$ = method
      ? this.shippingService.updateMethod(method.id, value)
      : this.shippingService.createMethod(value);

    try {
      await firstValueFrom(request$);
      this.isSubmitting.set(false);
      this.saved.emit();
      this.close.emit();
    } catch (e) {
      this.isSubmitting.set(false);
      alert('Error al guardar el método de envío.');
    }
  }
}
