import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ShippingService } from '../../services/shipping.service';
import { ShippingMethod, ShippingMethodType } from '../../interfaces/shipping.interface';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-shipping-method-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent, ButtonComponent, ModalComponent, InputComponent, ToggleComponent, SelectorComponent],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="(method ? 'Editar' : 'Nuevo') + ' Método de Envío'"
      [subtitle]="'Configura los detalles de la opción de entrega'"
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
          placeholder="Ej: Envío Local Express"
          [required]="true"
        ></app-input>

        <app-selector
          label="Tipo de Logística"
          formControlName="type"
          [options]="typeOptions"
          [required]="true"
        ></app-selector>

        <app-input
          *ngIf="showProviderField"
          label="Nombre del Proveedor"
          formControlName="provider_name"
          placeholder="Ej: Fedex, Servientrega..."
          class="animate-in slide-in-from-top-2 duration-200"
        ></app-input>

        <div class="grid grid-cols-2 gap-4">
          <app-input
            label="Días Mínimos"
            type="number"
            formControlName="min_days"
            placeholder="0"
            suffixText="Días"
          ></app-input>
          <app-input
            label="Días Máximos"
            type="number"
            formControlName="max_days"
            placeholder="5"
            suffixText="Días"
          ></app-input>
        </div>

        <div class="flex items-center justify-between p-4 rounded-xl border border-[var(--color-border)] bg-gray-50/30 mt-6">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center border border-green-100">
              <app-icon name="check" size="16" class="text-green-600"></app-icon>
            </div>
            <div>
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado Activo</span>
              <p class="text-xs text-[var(--color-text-secondary)]">Visible al finalizar la compra.</p>
            </div>
          </div>
          <app-toggle formControlName="is_active"></app-toggle>
        </div>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-3 w-full">
        <app-button variant="ghost" (clicked)="close.emit()">
          Cancelar
        </app-button>
        <app-button variant="primary" [loading]="isSubmitting" [disabled]="form.invalid" (clicked)="onSubmit()">
          <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
          {{ method ? 'Actualizar Método' : 'Crear Método' }}
        </app-button>
      </div>
    </app-modal>
  `
})
export class ShippingMethodModalComponent implements OnInit {
  @Input() method?: ShippingMethod;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingService);

  ShippingMethodType = ShippingMethodType;
  form: FormGroup;
  isSubmitting = false;

  typeOptions: SelectorOption[] = [
    { value: ShippingMethodType.PICKUP, label: 'Recogida en Tienda' },
    { value: ShippingMethodType.OWN_FLEET, label: 'Flota Propia' },
    { value: ShippingMethodType.CARRIER, label: 'Transportadora' },
    { value: ShippingMethodType.THIRD_PARTY_PROVIDER, label: 'Proveedor Externo' },
    { value: ShippingMethodType.CUSTOM, label: 'Personalizado' }
  ];

  constructor() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      type: [ShippingMethodType.CUSTOM, Validators.required],
      provider_name: [''],
      min_days: [null],
      max_days: [null],
      is_active: [true]
    });
  }

  ngOnInit() {
    if (this.method) {
      this.form.patchValue(this.method);
    }
  }

  get showProviderField(): boolean {
    const type = this.form.get('type')?.value;
    return type === ShippingMethodType.CARRIER || type === ShippingMethodType.THIRD_PARTY_PROVIDER;
  }

  onSubmit() {
    if (this.form.invalid) return;

    this.isSubmitting = true;
    const value = this.form.value;

    const request$ = this.method
      ? this.shippingService.updateMethod(this.method.id, value)
      : this.shippingService.createMethod(value);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        this.saved.emit();
        this.close.emit();
      },
      error: () => {
        this.isSubmitting = false;
        alert('Error al guardar el método de envío.');
      }
    });
  }
}
